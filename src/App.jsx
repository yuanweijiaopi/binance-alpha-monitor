import { useState, useEffect, useCallback, useRef } from "react";

const API_URL = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";

// CORS 代理列表，依次尝试直到成功
const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

async function fetchWithProxy(url) {
    // 加时间戳绕过代理缓存
    const bustUrl = `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    let lastErr;
    for (const makeProxy of CORS_PROXIES) {
        try {
            const res = await fetch(makeProxy(bustUrl), { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const text = await res.text();
            const json = JSON.parse(text);
            // allorigins /get 把数据包在 json.contents 里
            if (json && json.contents) return JSON.parse(json.contents);
            return json;
        } catch (e) {
            lastErr = e;
            // 继续尝试下一个代理
        }
    }
    throw new Error(`所有 ${CORS_PROXIES.length} 个代理均失败: ${lastErr?.message || "未知错误"}`);
}

const CHAIN_COLORS = {
    BSC: "#F0B90B",
    ETH: "#627EEA",
    Base: "#0052FF",
    SOL: "#9945FF",
};

function formatNum(n) {
    if (!n) return "—";
    const num = parseFloat(n);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
    return num.toFixed(4);
}

function formatPrice(p) {
    if (!p) return "—";
    const num = parseFloat(p);
    if (num < 0.000001) return num.toExponential(3);
    if (num < 0.01) return num.toFixed(8);
    if (num < 1) return num.toFixed(6);
    return num.toFixed(4);
}

function PulsingDot({ color }) {
    return (
        <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10 }}>
            <span style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: color, opacity: 0.4,
                animation: "ping 1.2s ease-in-out infinite"
            }} />
            <span style={{ borderRadius: "50%", width: 10, height: 10, background: color, display: "block" }} />
        </span>
    );
}

export default function App() {
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [refreshInterval, setRefreshInterval] = useState(5);
    const [countdown, setCountdown] = useState(5);
    const [filterMul, setFilterMul] = useState(4);
    const [sortBy, setSortBy] = useState("volume");
    const [search, setSearch] = useState("");
    const [newTokenIds, setNewTokenIds] = useState(new Set());
    // baselinePrices: 基准价格，首次加载时记录，之后刷新不覆盖，可手动重置
    const [baselinePrices, setBaselinePrices] = useState({});
    const [baselineTime, setBaselineTime] = useState(null);
    const baselineSetRef = useRef(false);
    const prevTokensRef = useRef([]);
    const timerRef = useRef(null);
    const countdownRef = useRef(refreshInterval);



    const fetchTokens = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const parsed = await fetchWithProxy(API_URL);
            if (parsed.success && parsed.data) {
                const all = parsed.data;
                const prevIds = new Set(prevTokensRef.current.map(t => t.alphaId));
                const newIds = new Set();
                const currentPrices = {};
                all.forEach(t => {
                    if (!prevIds.has(t.alphaId)) newIds.add(t.alphaId);
                    const p = parseFloat(t.price);
                    if (!isNaN(p)) currentPrices[t.alphaId] = p;
                });
                // 首次加载时记录基准价格
                if (!baselineSetRef.current) {
                    baselineSetRef.current = true;
                    setBaselinePrices(currentPrices);
                    setBaselineTime(new Date());
                }
                prevTokensRef.current = all;
                setNewTokenIds(newIds);
                setTokens(all);
                setLastUpdate(new Date());
                setError(null);
            } else {
                setError("API 返回异常，请稍后重试");
            }
        } catch (e) {
            setError(`获取失败: ${e.message}`);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchTokens();
    }, [fetchTokens]);

    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        countdownRef.current = refreshInterval;
        setCountdown(refreshInterval);
        timerRef.current = setInterval(() => {
            countdownRef.current -= 1;
            setCountdown(countdownRef.current);
            if (countdownRef.current <= 0) {
                countdownRef.current = refreshInterval;
                setCountdown(refreshInterval);
                fetchTokens();
            }
        }, 1000);
        return () => clearInterval(timerRef.current);
    }, [refreshInterval, fetchTokens]);

    const searchKey = search.trim().toLowerCase();
    const filtered = tokens
        .filter(t => filterMul === 0 ? true : (t.mulPoint || 1) >= filterMul)
        .filter(t => !searchKey || (t.symbol || "").toLowerCase().includes(searchKey))
        .sort((a, b) => {
            if (sortBy === "volume") return parseFloat(b.volume24h || 0) - parseFloat(a.volume24h || 0);
            if (sortBy === "mulPoint") return (b.mulPoint || 1) - (a.mulPoint || 1);
            if (sortBy === "change") return (parseFloat(b.percentChange24h) || 0) - (parseFloat(a.percentChange24h) || 0);
            if (sortBy === "marketCap") return parseFloat(b.marketCap || 0) - parseFloat(a.marketCap || 0);
            return 0;
        });

    const mulCounts = {};
    tokens.forEach(t => {
        const m = t.mulPoint || 1;
        mulCounts[m] = (mulCounts[m] || 0) + 1;
    });

    return (
        <div style={{
            minHeight: "100vh",
            background: "#0a0c10",
            color: "#e2e8f0",
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
            padding: "0",
        }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;700&display=swap');
        @keyframes ping { 0%,100%{transform:scale(1);opacity:.4} 50%{transform:scale(2.2);opacity:0} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 8px #F0B90B44} 50%{box-shadow:0 0 20px #F0B90B99} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .token-row { animation: fadeIn 0.3s ease; transition: background 0.2s; }
        .token-row:hover { background: #1a1f2e !important; }
        .mul-badge-4x { animation: glow 2s infinite; }
        .spin { animation: spin 0.8s linear infinite; display:inline-block; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0a0c10; }
        ::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 2px; }
        .btn { cursor:pointer; border:none; outline:none; transition: all 0.15s; }
        .btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .sort-btn { background: #1a1f2e; color: #94a3b8; padding: 5px 12px; border-radius: 4px; font-family: inherit; font-size: 11px; }
        .sort-btn.active { background: #F0B90B22; color: #F0B90B; border: 1px solid #F0B90B55; }
        .filter-chip { background: #1a1f2e; color: #94a3b8; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-family: inherit; cursor:pointer; border: 1px solid transparent; transition: all 0.15s; }
        .filter-chip.active { border-color: #F0B90B; color: #F0B90B; background: #F0B90B11; }
      `}</style>

            {/* Header */}
            <div style={{
                borderBottom: "1px solid #1e2533",
                padding: "20px 32px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                position: "sticky", top: 0, background: "#0a0c10", zIndex: 10
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 8,
                        background: "linear-gradient(135deg, #F0B90B, #ff6b35)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 18, fontWeight: 700
                    }}>α</div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "Space Grotesk, sans-serif", letterSpacing: -0.5 }}>
                            Binance Alpha Monitor
                        </div>
                        <div style={{ fontSize: 11, color: "#4a5568", marginTop: 1 }}>
                            积分倍数实时监控 · mulPoint tracker
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    {/* Stats */}
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                        {Object.entries(mulCounts).sort((a, b) => b[0] - a[0]).map(([mul, count]) => (
                            <div key={mul} style={{ textAlign: "center" }}>
                                <div style={{
                                    color: mul >= 4 ? "#F0B90B" : mul >= 2 ? "#68d391" : "#94a3b8",
                                    fontWeight: 700, fontSize: 14
                                }}>{count}</div>
                                <div style={{ color: "#4a5568", fontSize: 10 }}>{mul}x</div>
                            </div>
                        ))}
                    </div>

                    {/* Live indicator */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#4a5568" }}>
                        {loading ? (
                            <span style={{ color: "#4a5568" }}>加载中...</span>
                        ) : error ? (
                            <span style={{ color: "#fc8181" }}>● 错误</span>
                        ) : isRefreshing ? (
                            <>
                                <span className="spin" style={{ color: "#F0B90B", fontSize: 13 }}>↻</span>
                                <span style={{ color: "#F0B90B" }}>刷新中...</span>
                            </>
                        ) : (
                            <>
                                <PulsingDot color="#48bb78" />
                                <span style={{ color: "#48bb78" }}>实时</span>
                                <span style={{ color: "#2d3748" }}>|</span>
                                <span>{countdown}s 后刷新</span>
                            </>
                        )}
                    </div>

                    {/* Refresh interval */}
                    <select
                        value={refreshInterval}
                        onChange={e => setRefreshInterval(Number(e.target.value))}
                        style={{
                            background: "#1a1f2e", color: "#94a3b8", border: "1px solid #2d3748",
                            borderRadius: 4, padding: "4px 8px", fontSize: 11, fontFamily: "inherit",
                            cursor: "pointer", outline: "none"
                        }}
                    >
                        <option value={5}>5s刷新</option>
                        <option value={15}>15s刷新</option>
                        <option value={30}>30s刷新</option>
                        <option value={60}>1min刷新</option>
                        <option value={180}>3min刷新</option>
                    </select>

                    <button
                        onClick={() => {
                            baselineSetRef.current = false;
                            fetchTokens();
                        }}
                        className="btn"
                        style={{
                            background: "#1a1f2e", color: "#7dd3fc",
                            border: "1px solid #7dd3fc44",
                            borderRadius: 4, padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
                        }}
                        title={baselineTime ? `当前基准：${baselineTime.toLocaleTimeString("zh-CN")}` : ""}
                    >⊙ 重置基准</button>

                    <button
                        disabled={isRefreshing}
                        onClick={() => {
                            countdownRef.current = refreshInterval;
                            setCountdown(refreshInterval);
                            fetchTokens();
                        }}
                        className="btn"
                        style={{
                            background: isRefreshing ? "#111520" : "#1a1f2e",
                            color: isRefreshing ? "#4a5568" : "#F0B90B",
                            border: `1px solid ${isRefreshing ? "#2d374844" : "#F0B90B44"}`,
                            borderRadius: 4, padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
                            cursor: isRefreshing ? "not-allowed" : "pointer"
                        }}
                    >{isRefreshing ? "↻ 刷新中..." : "↻ 立即刷新"}</button>
                </div>
            </div>

            {/* Filter bar */}
            <div style={{
                padding: "12px 32px", borderBottom: "1px solid #1a1f2e",
                display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#4a5568" }}>倍数筛选：</span>
                    {[0, 1, 2, 3, 4].map(m => (
                        <button key={m} className={`filter-chip ${filterMul === m ? "active" : ""}`}
                            onClick={() => setFilterMul(m)}>
                            {m === 0 ? "全部" : `≥${m}x`}
                            {m > 0 && mulCounts[m] !== undefined && (
                                <span style={{ marginLeft: 4, opacity: 0.6 }}>({
                                    Object.entries(mulCounts).filter(([k]) => k >= m).reduce((s, [, v]) => s + v, 0)
                                })</span>
                            )}
                        </button>
                    ))}
                </div>

                <input
                    type="text"
                    placeholder="搜索代币..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                        background: "#1a1f2e", color: "#e2e8f0",
                        border: "1px solid #2d3748", borderRadius: 4,
                        padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
                        outline: "none", width: 160,
                    }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                    <span style={{ fontSize: 11, color: "#4a5568" }}>排序：</span>
                    {[
                        { key: "mulPoint", label: "倍数" },
                        { key: "volume", label: "成交量" },
                        { key: "change", label: "涨跌幅" },
                        { key: "marketCap", label: "市值" },
                    ].map(s => (
                        <button key={s.key} className={`sort-btn btn ${sortBy === s.key ? "active" : ""}`}
                            onClick={() => setSortBy(s.key)}>{s.label}</button>
                    ))}
                </div>
            </div>

            {/* Last update */}
            {lastUpdate && (
                <div style={{ padding: "6px 32px", fontSize: 10, color: "#2d3748", borderBottom: "1px solid #1a1f2e" }}>
                    最后更新：{lastUpdate.toLocaleTimeString("zh-CN")} · 共 {tokens.length} 个代币 · 显示 {filtered.length} 个
                    {baselineTime && <span style={{ marginLeft: 12, color: "#7dd3fc88" }}>· 基准时间：{baselineTime.toLocaleTimeString("zh-CN")}</span>}
                </div>
            )}

            {/* Error */}
            {error && (
                <div style={{
                    margin: "20px 32px", padding: "12px 16px",
                    background: "#fc818120", border: "1px solid #fc818140",
                    borderRadius: 6, fontSize: 12, color: "#fc8181"
                }}>
                    ⚠ {error}
                    <div style={{ marginTop: 6, fontSize: 10, color: "#fc818180" }}>
                        币安 API 可能存在 CORS 限制，尝试使用代理中...
                    </div>
                </div>
            )}

            {/* Table */}
            <div style={{ padding: "0 32px 32px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid #1e2533" }}>
                            {["代币", "链", "积分倍数", "价格", "基准变化", "24h涨跌", "24h成交量", "市值", "持有人"].map(h => (
                                <th key={h} style={{
                                    padding: "10px 12px", textAlign: "left",
                                    fontSize: 10, color: "#4a5568", fontWeight: 500,
                                    letterSpacing: "0.08em", textTransform: "uppercase"
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading && tokens.length === 0 ? (
                            <tr><td colSpan={9} style={{ textAlign: "center", padding: 60, color: "#4a5568" }}>
                                <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
                                <div>正在获取币安 Alpha 数据...</div>
                            </td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={9} style={{ textAlign: "center", padding: 60, color: "#4a5568" }}>
                                <div style={{ fontSize: 24, marginBottom: 8 }}>○</div>
                                <div>暂无符合条件的代币</div>
                            </td></tr>
                        ) : filtered.map((token, i) => {
                            const mul = token.mulPoint || 1;
                            const isNew = newTokenIds.has(token.alphaId);
                            const change = token.percentChange24h != null ? parseFloat(token.percentChange24h) : null;
                            const mulColor = mul >= 4 ? "#F0B90B" : mul >= 3 ? "#fbb040" : mul >= 2 ? "#68d391" : "#4a5568";
                            const chainColor = CHAIN_COLORS[token.chainName] || "#64748b";
                            // 基准变化 = 本次价格 vs 开始监控时的基准价格
                            const curPrice = parseFloat(token.price);
                            const basePrice = baselinePrices[token.alphaId];
                            const baseChange = (!isNaN(curPrice) && curPrice > 0 && basePrice > 0)
                                ? (curPrice - basePrice) / basePrice * 100
                                : null;

                            return (
                                <tr key={token.alphaId} className="token-row" style={{
                                    borderBottom: "1px solid #111520",
                                    background: isNew ? "#F0B90B08" : i % 2 === 0 ? "transparent" : "#0d0f18",
                                }}>
                                    {/* Token */}
                                    <td style={{ padding: "10px 12px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            {token.iconUrl ? (
                                                <img src={token.iconUrl} alt="" style={{
                                                    width: 28, height: 28, borderRadius: "50%",
                                                    border: `1px solid ${mulColor}44`
                                                }} onError={e => e.target.style.display = "none"} />
                                            ) : (
                                                <div style={{
                                                    width: 28, height: 28, borderRadius: "50%",
                                                    background: mulColor + "33", display: "flex", alignItems: "center",
                                                    justifyContent: "center", fontSize: 10, color: mulColor
                                                }}>{(token.symbol || "?")[0].toUpperCase()}</div>
                                            )}
                                            <div>
                                                <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                                                    {token.symbol}
                                                    {isNew && <span style={{
                                                        background: "#48bb7822", color: "#48bb78",
                                                        fontSize: 9, padding: "1px 5px", borderRadius: 3,
                                                        border: "1px solid #48bb7844", fontWeight: 500
                                                    }}>NEW</span>}
                                                    {token.hotTag && <span style={{
                                                        background: "#fc818122", color: "#fc8181",
                                                        fontSize: 9, padding: "1px 5px", borderRadius: 3,
                                                        border: "1px solid #fc818144"
                                                    }}>HOT</span>}
                                                </div>
                                                <div style={{ fontSize: 10, color: "#4a5568", marginTop: 1 }}>{token.name}</div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Chain */}
                                    <td style={{ padding: "10px 12px" }}>
                                        <span style={{
                                            background: chainColor + "22", color: chainColor,
                                            padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                            border: `1px solid ${chainColor}44`, fontWeight: 500
                                        }}>{token.chainName || "—"}</span>
                                    </td>

                                    {/* Mul Point */}
                                    <td style={{ padding: "10px 12px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <div className={mul >= 4 ? "mul-badge-4x" : ""} style={{
                                                background: mulColor + "22",
                                                color: mulColor,
                                                border: `1px solid ${mulColor}66`,
                                                borderRadius: 6, padding: "4px 12px",
                                                fontSize: 15, fontWeight: 700,
                                                display: "inline-block"
                                            }}>{mul}x</div>
                                            {mul >= 4 && <PulsingDot color={mulColor} />}
                                        </div>
                                    </td>

                                    {/* Price */}
                                    <td style={{ padding: "10px 12px", color: "#cbd5e1", fontFamily: "IBM Plex Mono, monospace" }}>
                                        ${formatPrice(curPrice)}
                                    </td>

                                    {/* 基准变化：本次价格 vs 开始监控时的基准价 */}
                                    <td style={{ padding: "10px 12px" }}>
                                        {baseChange === null ? (
                                            <span style={{ color: "#2d3748", fontSize: 11 }}>—</span>
                                        ) : Math.abs(baseChange) < 0.0001 ? (
                                            <span style={{ color: "#4a5568", fontSize: 11 }}>±0.00%</span>
                                        ) : (
                                            <span style={{
                                                color: baseChange >= 0 ? "#4ade80" : "#f87171",
                                                fontWeight: 600, fontSize: 12,
                                                background: baseChange >= 0 ? "#4ade8011" : "#f8717111",
                                                padding: "2px 6px", borderRadius: 4,
                                                border: `1px solid ${baseChange >= 0 ? "#4ade8033" : "#f8717133"}`
                                            }}>
                                                {baseChange >= 0 ? "▲" : "▼"} {Math.abs(baseChange) < 0.01
                                                    ? Math.abs(baseChange).toFixed(4)
                                                    : Math.abs(baseChange).toFixed(2)}%
                                            </span>
                                        )}
                                    </td>

                                    {/* 24h Change */}
                                    <td style={{ padding: "10px 12px" }}>
                                        {change === null ? (
                                            <span style={{ color: "#2d3748", fontSize: 11 }}>—</span>
                                        ) : (
                                            <span style={{
                                                color: change >= 0 ? "#68d391" : "#fc8181",
                                                fontWeight: 500
                                            }}>
                                                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                                            </span>
                                        )}
                                    </td>

                                    {/* Volume */}
                                    <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                                        ${formatNum(token.volume24h)}
                                    </td>

                                    {/* Market Cap */}
                                    <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                                        ${formatNum(token.marketCap)}
                                    </td>

                                    {/* Holders */}
                                    <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                                        {parseInt(token.holders || 0).toLocaleString()}
                                    </td>

                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
