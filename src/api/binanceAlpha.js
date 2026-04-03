const LOCAL_PROXY = "http://localhost:3001";

const BINANCE_URL =
    "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";

const STABILITY_URL = "https://alpha123.uk/stability/stability_feed_v3.json";
const ALPHA123_DATA_URL = "https://alpha123.uk/api/data";

// CORS 代理列表（降级用）
const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// 上次成功的代理索引，下次优先使用
let lastSuccessProxyIdx = 0;

function parseProxyResponse(json) {
    if (json && json.contents) return JSON.parse(json.contents);
    return json;
}

/**
 * 并行竞速代理（降级路径）
 */
async function fetchWithProxy(url, timeout = 2500) {
    const bustUrl = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    const ordered = [
        ...CORS_PROXIES.slice(lastSuccessProxyIdx),
        ...CORS_PROXIES.slice(0, lastSuccessProxyIdx),
    ];
    const attempts = ordered.map((makeProxy, idx) =>
        fetch(makeProxy(bustUrl), { signal: AbortSignal.timeout(timeout) })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const text = await res.text();
                const json = JSON.parse(text);
                lastSuccessProxyIdx = (lastSuccessProxyIdx + idx) % CORS_PROXIES.length;
                return parseProxyResponse(json);
            })
    );
    try {
        return await Promise.any(attempts);
    } catch {
        throw new Error("所有 CORS 代理均失败，请检查网络或稍后重试");
    }
}

// 优先直连（alpha123.uk 等有 CORS 头的接口），失败后竞速代理
async function fetchJson(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (res.ok) return await res.json();
    } catch (_) { /* 降级 */ }
    return fetchWithProxy(url, 2500);
}

// ── 主数据：优先本地代理服务器，不可用则降级 CORS 代理 ─────────────────────
export async function fetchAlphaTokens() {
    // 1. 尝试本地代理（1.5s 超时，几乎不会耗时）
    try {
        const res = await fetch(`${LOCAL_PROXY}/api/tokens`, {
            signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) return json.data;
        }
    } catch (_) {
        // 本地服务未启动，降级到公共 CORS 代理
    }

    // 2. 降级：并行竞速 CORS 代理
    const parsed = await fetchWithProxy(BINANCE_URL);
    if (parsed.success && parsed.data) return parsed.data;
    throw new Error("API 返回异常，请稍后重试");
}

export async function fetchLocalReferenceStability() {
    const res = await fetch(`${LOCAL_PROXY}/api/reference-stability`, {
        signal: AbortSignal.timeout(800),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success && json.data) return json.data;
    return {};
}

// ── 稳定度 / Top3 缓存（60s TTL）────────────────────────────────────────────
const STALE_TTL = 1_000;
let stabilityCache = { data: null, ts: 0 };
let alpha123Cache  = { data: null, ts: 0 };

export async function fetchStabilityFeed() {
    if (stabilityCache.data && Date.now() - stabilityCache.ts < STALE_TTL) {
        return stabilityCache.data;
    }
    const json = await fetchJson(STABILITY_URL);
    const map = {};
    for (const item of json.items || []) {
        const symbol = item.n.split("/")[0];
        map[symbol] = { stability: item.st, spread: item.spr, mul4Days: item.md };
    }
    stabilityCache = { data: map, ts: Date.now() };
    return map;
}

export async function fetchAlpha123Data() {
    if (alpha123Cache.data && Date.now() - alpha123Cache.ts < STALE_TTL) {
        return alpha123Cache.data;
    }
    const json = await fetchJson(ALPHA123_DATA_URL);
    const result = {
        top3: json.top3_tokens || [],
        bnbPrice: json.bnb_price_usd || null,
    };
    alpha123Cache = { data: result, ts: Date.now() };
    return result;
}
