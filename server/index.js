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
const STATS_FETCH_INTERVAL_MS  = 30_000;
const ALPHA_FETCH_INTERVAL_MS  = 60_000;
const REFERENCE_FETCH_INTERVAL_MS = 1_000;

// 代理由环境变量 HTTPS_PROXY / ALL_PROXY 提供，curl 自动继承，无需硬编码

const BINANCE_ALPHA_URL  = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";
const BINANCE_PRICE_URL  = "https://api.binance.com/api/v3/ticker/price";
const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";
const ALPHA123_STABILITY_URL = "https://alpha123.uk/stability/stability_feed_v3.json";

// ── 状态 ──────────────────────────────────────────────────────────────────────
let alphaTokens  = [];   // Alpha 列表（mulPoint、iconUrl 等静态字段）
let priceMap     = {};   // symbol -> price string，每 2s 更新
let stabilityMap = {};   // symbol -> { stability, spread }，每 3s 从订单簿计算
let referenceStabilityMap = {}; // symbol -> { stability, spread, mul4Days }，每 3s 更新
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

/** 根据买卖价差基点分类稳定度（有现货订单簿时使用） */
function classifyBySpread(spreadBps) {
    if (spreadBps <  1)  return "green:stable";
    if (spreadBps <  5)  return "yellow:normal";
    if (spreadBps < 20)  return "yellow:moderate";
    return "red:unstable";
}

/** 根据 24h 涨跌幅估算稳定度（DEX 代币降级用，无订单簿时） */
function classifyByChange(changePercent) {
    const abs = Math.abs(parseFloat(changePercent) || 0);
    if (abs <  3)  return "green:stable";
    if (abs < 10)  return "yellow:normal";
    if (abs < 25)  return "yellow:moderate";
    return "red:unstable";
}

// ── curl 封装（自动走系统代理） ───────────────────────────────────────────────
// 给 URL 加时间戳参数，防止代理缓存返回旧数据
function bustCache(url) {
    return url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now();
}

async function fetchJson(url, opts = {}) {
    const { maxBuffer = 4 * 1024 * 1024, timeout = 12000 } = opts;
    const cmd = [
        "curl", "-sS", "--max-time", String(Math.floor(timeout / 1000) - 2),
        "--compressed",
        "-H", '"Accept: application/json"',
        '"' + bustCache(url) + '"',
    ].join(" ");
    try {
        const { stdout } = await execAsync(cmd, { timeout, maxBuffer });
        return JSON.parse(stdout);
    } catch (err) {
        console.error("[fetchJson] CMD:", cmd);
        console.error("[fetchJson] ERR:", err.message);
        if (err.stderr) console.error("[fetchJson] STDERR:", err.stderr);
        throw err;
    }
}

async function curlFetch(url) {
    const cmd = [
        "curl", "-sS", "--max-time", "10",
        "--compressed",
        "-H", '"User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"',
        "-H", '"Accept: application/json"',
        '"' + bustCache(url) + '"',
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
        broadcast({ type: "data", success: true, data: merged, stabilityMap, referenceStabilityMap, ts, fetchCount, changeCount });
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

// ── 拉取 24h 统计 + 订单簿价差（每 30s，只请求 priceMap 中有价格的现货对） ──
// 24hr ticker 的 FULL 响应自带 bidPrice/askPrice，不需要额外请求 bookTicker
async function fetchStats() {
    if (alphaTokens.length === 0) return;
    const alphaSet = new Set(alphaTokens.map(t => t.symbol + "USDT"));

    // 只请求已有价格的现货对，避免全量下载（5-10MB → ~50KB）
    const spotSymbols = Object.keys(priceMap).map(s => s + "USDT").filter(s => alphaSet.has(s));
    if (spotSymbols.length === 0) return;

    const filteredUrl = BINANCE_TICKER_URL + "?symbols=" + encodeURIComponent(JSON.stringify(spotSymbols));
    try {
        const data = await fetchJson(filteredUrl, { maxBuffer: 4 * 1024 * 1024, timeout: 15000 });
        if (!Array.isArray(data)) return;

        const newStabilityMap = {};
        for (const item of data) {
            if (!alphaSet.has(item.symbol)) continue;
            const sym = item.symbol.slice(0, -4);

            // 24h 涨跌 + 成交量
            statsMap[sym] = {
                percentChange24h: item.priceChangePercent,
                volume24h: item.quoteVolume,
            };

            // 订单簿价差 → 稳定度（bid/ask 来自 24hr ticker FULL 响应）
            const bid = parseFloat(item.bidPrice);
            const ask = parseFloat(item.askPrice);
            if (bid > 0 && ask > 0) {
                const mid = (bid + ask) / 2;
                const spreadBps = parseFloat(((ask - bid) / mid * 10000).toFixed(4));
                newStabilityMap[sym] = { spread: spreadBps, stability: classifyBySpread(spreadBps), source: "orderbook" };
            } else {
                newStabilityMap[sym] = { spread: null, stability: "red:no_trade", source: "orderbook" };
            }
        }

        // ── DEX 代币降级：用涨跌幅估算稳定度，覆盖没有现货数据的代币 ────────
        for (const t of alphaTokens) {
            if (newStabilityMap[t.symbol]) continue;  // 已有现货数据，跳过
            const change = t.percentChange24h ?? statsMap[t.symbol]?.percentChange24h;
            if (change != null) {
                newStabilityMap[t.symbol] = {
                    spread: null,
                    stability: classifyByChange(change),
                    source: "volatility",
                };
            }
        }

        stabilityMap = newStabilityMap;
        const withSpread = Object.values(newStabilityMap).filter(v => v.source === "orderbook" && v.spread !== null).length;
        const withVol    = Object.values(newStabilityMap).filter(v => v.source === "volatility").length;
        console.log(`[Stats] 更新：现货价差 ${withSpread} 个 + 波动率估算 ${withVol} 个 = 共 ${Object.keys(newStabilityMap).length} 个`);
        broadcast({ type: "stability", stabilityMap: newStabilityMap, ts: new Date().toISOString() });
    } catch (err) {
        console.error("[Stats] 拉取失败:", (err.message || "").slice(0, 80));
    }
}

async function fetchReferenceStability() {
    try {
        const json = await fetchJson(ALPHA123_STABILITY_URL, { maxBuffer: 2 * 1024 * 1024, timeout: 5000 });
        const items = Array.isArray(json?.items) ? json.items : [];
        const nextMap = {};

        for (const item of items) {
            const symbol = item?.n?.split("/")?.[0];
            if (!symbol) continue;
            nextMap[symbol] = {
                stability: item.st ?? null,
                spread: item.spr ?? null,
                mul4Days: item.md ?? null,
            };
        }

        referenceStabilityMap = nextMap;
        broadcast({
            type: "reference_stability",
            referenceStabilityMap: nextMap,
            ts: new Date().toISOString(),
        });
    } catch (err) {
        console.error("[Reference] 拉取失败:", (err.message || "").slice(0, 80));
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
                data: tokenCache.data, stabilityMap, referenceStabilityMap, ts, fetchCount, changeCount,
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

    if (url.pathname === "/api/reference-stability") {
        res.writeHead(200, corsHeaders({ "Content-Type": "application/json" }));
        res.end(JSON.stringify({ success: true, data: referenceStabilityMap }));
        return;
    }

    if (url.pathname === "/api/health") {
        res.writeHead(200, corsHeaders({ "Content-Type": "application/json" }));
        res.end(JSON.stringify({
            ok: true,
            alphaCount:    alphaTokens.length,
            priceCount:    Object.keys(priceMap).length,
            spreadCount:   Object.keys(stabilityMap).length,
            referenceCount:Object.keys(referenceStabilityMap).length,
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
    console.log(`   实时价格：     每 ${PRICE_FETCH_INTERVAL_MS / 1000}s`);
    console.log(`   24h统计+价差：每 ${STATS_FETCH_INTERVAL_MS / 1000}s  ← bid/ask 来自 Binance ticker`);
    console.log(`   Alpha 列表：  每 ${ALPHA_FETCH_INTERVAL_MS / 1000}s\n`);

    await refreshAlphaList();
    await fetchReferenceStability();

    // 先拿到一轮价格，再立刻补齐统计/稳定度，避免首屏数据缺字段。
    await fetchPrices();
    await fetchStats();

    setInterval(refreshAlphaList, ALPHA_FETCH_INTERVAL_MS);
    setInterval(fetchStats,       STATS_FETCH_INTERVAL_MS);
    setInterval(fetchPrices,      PRICE_FETCH_INTERVAL_MS);
    setInterval(fetchReferenceStability, REFERENCE_FETCH_INTERVAL_MS);
});
