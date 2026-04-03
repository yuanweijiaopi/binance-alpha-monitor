/**
 * 本地代理服务器（四层分频刷新 + SSE 推送）
 *
 * - 实时价格       /api/v3/ticker/price   每 2s   (weight=2)
 * - 订单簿价差     /api/v3/bookTicker     每 3s   (weight=2) → 自算稳定度
 * - 24h涨跌+成交量  /api/v3/ticker/24hr    每 30s  (weight=40，全量)
 * - Alpha 列表     Binance Alpha API      每 60s  (curl 抓取)
 *
 * 运行：node server/index.js
 */

import http from "http";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const PORT = 3001;

const PRICE_FETCH_INTERVAL_MS  =  2_000;
const SPREAD_FETCH_INTERVAL_MS =  3_000;
const STATS_FETCH_INTERVAL_MS  = 30_000;
const ALPHA_FETCH_INTERVAL_MS  = 60_000;

const BINANCE_ALPHA_URL      = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";
const BINANCE_PRICE_URL      = "https://api.binance.com/api/v3/ticker/price";
const BINANCE_BOOKTICKER_URL = "https://api.binance.com/api/v3/bookTicker";
const BINANCE_TICKER_URL     = "https://api.binance.com/api/v3/ticker/24hr";

// ── 状态 ──────────────────────────────────────────────────────────────────────
let alphaTokens  = [];   // Alpha 列表（mulPoint、iconUrl 等静态字段）
let priceMap     = {};   // symbol -> price string，每 2s 更新
let stabilityMap = {};   // symbol -> { stability, spread }，每 3s 从订单簿计算
let statsMap     = {};   // symbol -> { percentChange24h, volume24h }，每 30s 更新
let tokenCache   = null;
let lastFetchTime = null;
let fetchCount   = 0;
let changeCount  = 0;
let lastFingerprint = "";

const sseClients = new Set();

function broadcast(payload) {
    const msg = "data: " + JSON.stringify(payload) + "\n\n";
    sseClients.forEach(client => {
        try { client.write(msg); } catch (_) { sseClients.delete(client); }
    });
}

function makeFingerprint(data) {
    return data.map(t => `${t.alphaId}:${t.price}:${t.percentChange24h}:${t.volume24h}`).join("|");
}

/** 根据价差基点（bps）分类稳定度 */
function classifyStability(spreadBps) {
    if (spreadBps <  1)  return "green:stable";
    if (spreadBps <  5)  return "yellow:normal";
    if (spreadBps < 20)  return "yellow:moderate";
    return "red:unstable";
}

// ── curl 封装（自动走系统代理） ───────────────────────────────────────────────
async function fetchJson(url, opts = {}) {
    const { maxBuffer = 4 * 1024 * 1024, timeout = 12000 } = opts;
    const cmd = [
        "curl", "-sS", "--max-time", String(Math.floor(timeout / 1000) - 2),
        "--compressed",
        "-H", '"Accept: application/json"',
        '"' + url + '"',
    ].join(" ");
    const { stdout } = await execAsync(cmd, { timeout, maxBuffer });
    return JSON.parse(stdout);
}

async function curlFetch(url) {
    const cmd = [
        "curl", "-sS", "--max-time", "10", "--compressed",
        "-H", '"User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"',
        "-H", '"Accept: application/json"',
        '"' + url + '"',
    ].join(" ");
    const { stdout } = await execAsync(cmd, { timeout: 12000 });
    return JSON.parse(stdout);
}

// ── 合并所有数据并推送（价格变化时触发） ─────────────────────────────────────
function mergeAndBroadcast() {
    if (alphaTokens.length === 0) return;

    const merged = alphaTokens.map(t => ({
        ...t,
        price:            priceMap[t.symbol]              ?? t.price,
        percentChange24h: statsMap[t.symbol]?.percentChange24h ?? t.percentChange24h,
        volume24h:        statsMap[t.symbol]?.volume24h        ?? t.volume24h,
    }));

    const fp = makeFingerprint(merged);
    const dataChanged = fp !== lastFingerprint;
    lastFingerprint = fp;
    fetchCount++;

    const ts = new Date().toISOString();
    if (dataChanged) {
        changeCount++;
        lastFetchTime = new Date();
        tokenCache = { success: true, data: merged };
        console.log(`[Price] #${fetchCount} ✦ 变化 → 推送 (变化:${changeCount}/总:${fetchCount})`);
        // 价格数据 + 最新稳定度一起推送
        broadcast({ type: "data", success: true, data: merged, stabilityMap, ts, fetchCount, changeCount });
    } else {
        broadcast({ type: "ping", ts, fetchCount, changeCount });
    }
}

// ── 拉取实时价格（每 2s，weight=2） ──────────────────────────────────────────
async function fetchPrices() {
    if (alphaTokens.length === 0) return;
    const alphaSet = new Set(alphaTokens.map(t => t.symbol + "USDT"));
    try {
        const data = await fetchJson(BINANCE_PRICE_URL);
        if (!Array.isArray(data)) return;
        for (const item of data) {
            if (alphaSet.has(item.symbol)) {
                priceMap[item.symbol.slice(0, -4)] = item.price;
            }
        }
        mergeAndBroadcast();
    } catch (err) {
        console.error("[Price] 拉取失败:", (err.message || "").slice(0, 80));
    }
}

// ── 拉取订单簿计算价差/稳定度（每 3s，weight=2） ─────────────────────────────
async function fetchSpread() {
    if (alphaTokens.length === 0) return;
    const alphaSet = new Set(alphaTokens.map(t => t.symbol + "USDT"));
    try {
        const data = await fetchJson(BINANCE_BOOKTICKER_URL);
        if (!Array.isArray(data)) return;

        const newMap = {};
        for (const item of data) {
            if (!alphaSet.has(item.symbol)) continue;
            const sym = item.symbol.slice(0, -4);
            const bid = parseFloat(item.bidPrice);
            const ask = parseFloat(item.askPrice);
            if (!bid || !ask || bid <= 0 || ask <= 0) {
                newMap[sym] = { stability: "red:no_trade", spread: null };
                continue;
            }
            const mid = (bid + ask) / 2;
            const spreadBps = parseFloat(((ask - bid) / mid * 10000).toFixed(4));
            newMap[sym] = { spread: spreadBps, stability: classifyStability(spreadBps) };
        }
        stabilityMap = newMap;
        // 推送稳定度更新（不管价格是否变化，稳定度独立推送）
        broadcast({ type: "stability", stabilityMap: newMap, ts: new Date().toISOString() });
    } catch (err) {
        console.error("[Spread] 拉取失败:", (err.message || "").slice(0, 80));
    }
}

// ── 拉取 24h 涨跌幅 + 成交量（每 30s，全量，maxBuffer 20MB） ─────────────────
async function fetchStats() {
    if (alphaTokens.length === 0) return;
    const alphaSet = new Set(alphaTokens.map(t => t.symbol + "USDT"));
    try {
        const data = await fetchJson(BINANCE_TICKER_URL, { maxBuffer: 20 * 1024 * 1024, timeout: 25000 });
        if (!Array.isArray(data)) return;
        for (const item of data) {
            if (alphaSet.has(item.symbol)) {
                statsMap[item.symbol.slice(0, -4)] = {
                    percentChange24h: item.priceChangePercent,
                    volume24h: item.quoteVolume,
                };
            }
        }
        console.log(`[Stats] 24h 统计更新：${Object.keys(statsMap).length} 个`);
    } catch (err) {
        console.error("[Stats] 拉取失败:", (err.message || "").slice(0, 80));
    }
}

// ── 刷新 Alpha 列表（每 60s） ─────────────────────────────────────────────────
async function refreshAlphaList() {
    try {
        const json = await curlFetch(BINANCE_ALPHA_URL);
        if (json.success && json.data) {
            alphaTokens = json.data;
            console.log(`[Alpha] 列表刷新：${alphaTokens.length} 个代币`);
        }
    } catch (err) {
        console.error("[Alpha] 列表刷新失败:", (err.message || "").slice(0, 80));
    }
}

// ── HTTP 服务 ─────────────────────────────────────────────────────────────────
function corsHeaders(extra) {
    return Object.assign({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
    }, extra || {});
}

const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
    }

    const url = new URL(req.url, "http://localhost:" + PORT);

    // ── SSE 推送 ─────────────────────────────────────────────────────────────
    if (url.pathname === "/api/stream") {
        res.writeHead(200, corsHeaders({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }));
        res.write("retry: 2000\n\n");

        // 新连接立即推送缓存（含稳定度）
        if (tokenCache) {
            const ts = lastFetchTime ? lastFetchTime.toISOString() : new Date().toISOString();
            res.write("data: " + JSON.stringify({
                type: "data", success: true,
                data: tokenCache.data, stabilityMap, ts, fetchCount, changeCount,
            }) + "\n\n");
        }

        sseClients.add(res);
        console.log(`[SSE] 新客户端连接，当前 ${sseClients.size} 个`);

        const heartbeat = setInterval(() => {
            try { res.write(": heartbeat\n\n"); } catch (_) {}
        }, 25000);

        req.on("close", () => {
            sseClients.delete(res);
            clearInterval(heartbeat);
            console.log(`[SSE] 客户端断开，当前 ${sseClients.size} 个`);
        });
        return;
    }

    if (url.pathname === "/api/tokens") {
        if (!tokenCache) {
            res.writeHead(503, corsHeaders({ "Content-Type": "application/json" }));
            res.end(JSON.stringify({ error: "数据尚未就绪，请稍后重试" }));
            return;
        }
        res.writeHead(200, corsHeaders({ "Content-Type": "application/json" }));
        res.end(JSON.stringify(tokenCache));
        return;
    }

    if (url.pathname === "/api/health") {
        res.writeHead(200, corsHeaders({ "Content-Type": "application/json" }));
        res.end(JSON.stringify({
            ok: true,
            alphaCount:    alphaTokens.length,
            priceCount:    Object.keys(priceMap).length,
            spreadCount:   Object.keys(stabilityMap).length,
            statsCount:    Object.keys(statsMap).length,
            lastFetch:     lastFetchTime ? lastFetchTime.toISOString() : null,
            fetchCount, changeCount,
            sseClients:    sseClients.size,
        }));
        return;
    }

    res.writeHead(404, corsHeaders({ "Content-Type": "application/json" }));
    res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, async () => {
    console.log(`\n🚀 本地代理服务器启动 → http://localhost:${PORT}`);
    console.log(`   实时价格：  每 ${PRICE_FETCH_INTERVAL_MS / 1000}s`);
    console.log(`   订单簿价差：每 ${SPREAD_FETCH_INTERVAL_MS / 1000}s  ← 自算稳定度，不依赖三方`);
    console.log(`   24h 统计：  每 ${STATS_FETCH_INTERVAL_MS / 1000}s`);
    console.log(`   Alpha 列表：每 ${ALPHA_FETCH_INTERVAL_MS / 1000}s\n`);

    await refreshAlphaList();
    await fetchStats();
    await fetchSpread();   // 先算一次稳定度
    await fetchPrices();   // 开始推送

    setInterval(refreshAlphaList, ALPHA_FETCH_INTERVAL_MS);
    setInterval(fetchStats,       STATS_FETCH_INTERVAL_MS);
    setInterval(fetchSpread,      SPREAD_FETCH_INTERVAL_MS);
    setInterval(fetchPrices,      PRICE_FETCH_INTERVAL_MS);
});
