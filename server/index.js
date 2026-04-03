/**
 * 本地代理服务器（四层分频刷新 + SSE 推送）
 *
 * - 实时价格       /api/v3/ticker/price        每 2s   (weight=2)
 * - 24h涨跌+成交量  /api/v3/ticker/24hr         每 30s  (weight=40)
 * - 稳定度/价差     alpha123.uk/stability_feed  每 15s
 * - Alpha 列表     Binance Alpha API            每 60s  (curl 抓取)
 *
 * 运行：node server/index.js
 */

import http from "http";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const PORT = 3001;

const PRICE_FETCH_INTERVAL_MS      =  2_000;
const STATS_FETCH_INTERVAL_MS      = 30_000;
const STABILITY_FETCH_INTERVAL_MS  = 15_000;
const ALPHA_FETCH_INTERVAL_MS      = 60_000;

const BINANCE_ALPHA_URL  = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";
const BINANCE_PRICE_URL  = "https://api.binance.com/api/v3/ticker/price";
const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";
const STABILITY_URL      = "https://alpha123.uk/stability/stability_feed_v3.json";

// ── 状态 ──────────────────────────────────────────────────────────────────────
let alphaTokens  = [];   // Alpha 列表（mulPoint、iconUrl 等静态字段）
let priceMap     = {};   // symbol -> price string，每 2s 更新
let statsMap     = {};   // symbol -> { percentChange24h, volume24h }，每 30s 更新
let stabilityMap = {};   // symbol -> { stability, spread, mul4Days }，每 15s 更新
let tokenCache   = null;
let lastFetchTime = null;
let fetchCount   = 0;
let changeCount  = 0;
let lastFingerprint      = "";
let lastStabilityHash    = "";

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

// ── 所有外部请求统一走 curl（自动使用系统代理，绕过国内屏蔽） ─────────────
async function fetchJson(url) {
    const cmd = [
        "curl", "-sS", "--max-time", "10", "--compressed",
        "-H", '"Accept: application/json"',
        '"' + url + '"',
    ].join(" ");
    const { stdout } = await execAsync(cmd, { timeout: 12000 });
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

// ── 合并价格/统计数据并推送（主驱动，每 2s 触发） ──────────────────────────
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
        console.log(`[Price] #${fetchCount} ✦ 价格变化 → 推送 (变化:${changeCount}/总:${fetchCount})`);
        broadcast({ type: "data", success: true, data: merged, ts, fetchCount, changeCount });
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

// ── 拉取 24h 涨跌幅 + 成交量（每 30s） ───────────────────────────────────────
async function fetchStats() {
    if (alphaTokens.length === 0) return;
    // 只拉 Alpha 代币，避免全量 ticker 超出 execAsync 缓冲区
    const symbols = JSON.stringify(alphaTokens.map(t => t.symbol + "USDT"));
    const url = `${BINANCE_TICKER_URL}?symbols=${encodeURIComponent(symbols)}`;
    try {
        const data = await fetchJson(url);
        if (!Array.isArray(data)) return;
        for (const item of data) {
            if (item.symbol?.endsWith("USDT")) {
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

// ── 拉取稳定度 + 价差（每 15s） ──────────────────────────────────────────────
async function fetchStability() {
    try {
        // 用带浏览器 UA 的 curlFetch，确保 alpha123.uk 返回完整数据
        const json = await curlFetch(STABILITY_URL);
        const map = {};
        for (const item of json.items || []) {
            const symbol = item.n.split("/")[0];
            map[symbol] = { stability: item.st, spread: item.spr, mul4Days: item.md };
        }
        // 简单哈希：用条目数 + 第一个 spread 判断是否变化
        const hash = Object.keys(map).length + "|" + (json.items?.[0]?.spr ?? "");
        if (hash === lastStabilityHash) return;  // 无变化不推送
        lastStabilityHash = hash;
        stabilityMap = map;
        broadcast({ type: "stability", stabilityMap: map, ts: new Date().toISOString() });
        console.log(`[Stability] 更新 → 推送 (${Object.keys(map).length} 个代币)`);
    } catch (err) {
        console.error("[Stability] 拉取失败:", (err.message || "").slice(0, 80));
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

        // 新连接立即推送缓存
        if (tokenCache) {
            const ts = lastFetchTime ? lastFetchTime.toISOString() : new Date().toISOString();
            res.write("data: " + JSON.stringify({
                type: "data", success: true,
                data: tokenCache.data, ts, fetchCount, changeCount,
            }) + "\n\n");
        }
        if (Object.keys(stabilityMap).length > 0) {
            res.write("data: " + JSON.stringify({
                type: "stability", stabilityMap, ts: new Date().toISOString(),
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
            alphaCount: alphaTokens.length,
            priceCount: Object.keys(priceMap).length,
            statsCount: Object.keys(statsMap).length,
            stabilityCount: Object.keys(stabilityMap).length,
            lastFetch: lastFetchTime ? lastFetchTime.toISOString() : null,
            fetchCount, changeCount,
            sseClients: sseClients.size,
        }));
        return;
    }

    res.writeHead(404, corsHeaders({ "Content-Type": "application/json" }));
    res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, async () => {
    console.log(`\n🚀 本地代理服务器启动 → http://localhost:${PORT}`);
    console.log(`   实时价格：  每 ${PRICE_FETCH_INTERVAL_MS / 1000}s`);
    console.log(`   24h 统计：  每 ${STATS_FETCH_INTERVAL_MS / 1000}s`);
    console.log(`   稳定度/价差：每 ${STABILITY_FETCH_INTERVAL_MS / 1000}s`);
    console.log(`   Alpha 列表：每 ${ALPHA_FETCH_INTERVAL_MS / 1000}s\n`);

    // 启动顺序：列表 → 统计 → 稳定度 → 价格（开始循环推送）
    await refreshAlphaList();
    await fetchStats();
    await fetchStability();
    await fetchPrices();

    setInterval(refreshAlphaList, ALPHA_FETCH_INTERVAL_MS);
    setInterval(fetchStats,       STATS_FETCH_INTERVAL_MS);
    setInterval(fetchStability,   STABILITY_FETCH_INTERVAL_MS);
    setInterval(fetchPrices,      PRICE_FETCH_INTERVAL_MS);
});