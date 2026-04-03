import { useState, useEffect, useCallback, useRef } from "react";
import "./index.css";
import { fetchAlphaTokens, fetchAlpha123Data } from "./api/binanceAlpha";
import Header from "./components/Header";
import FilterBar from "./components/FilterBar";
import Top3Bar from "./components/Top3Bar";
import TokenTable from "./components/TokenTable";

const LOCAL_STREAM = "http://localhost:3001/api/stream";

export default function App() {
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [refreshInterval, setRefreshInterval] = useState(3);
    const [countdown, setCountdown] = useState(3);
    const [filterMul, setFilterMul] = useState(4);
    const [sortBy, setSortBy] = useState("volume");
    const [search, setSearch] = useState("");
    const [newTokenIds, setNewTokenIds] = useState(new Set());
    const [baselinePrices, setBaselinePrices] = useState({});
    const [baselineTime, setBaselineTime] = useState(null);
    const [stabilityMap, setStabilityMap] = useState({});
    const [top3, setTop3] = useState([]);
    const [bnbPrice, setBnbPrice] = useState(null);
    const [sseActive, setSseActive] = useState(false); // SSE 是否已连接
    const [sseFetchCount, setSseFetchCount] = useState(0);   // 服务器总检查次数
    const [sseChangeCount, setSseChangeCount] = useState(0); // 数据实际变化次数
    const [lastCheckTime, setLastCheckTime] = useState(null); // 最后一次服务器检查时间

    const baselineSetRef = useRef(false);
    const prevTokensRef = useRef([]);
    const timerRef = useRef(null);
    const countdownRef = useRef(3);

    // ── 处理代币数据（SSE 和轮询共用） ─────────────────────────────────────
    const processTokenData = useCallback((data) => {
        const prevIds = new Set(prevTokensRef.current.map(t => t.alphaId));
        const newIds = new Set();
        const currentPrices = {};
        data.forEach(t => {
            if (!prevIds.has(t.alphaId)) newIds.add(t.alphaId);
            const p = parseFloat(t.price);
            if (!isNaN(p)) currentPrices[t.alphaId] = p;
        });
        if (!baselineSetRef.current) {
            baselineSetRef.current = true;
            setBaselinePrices(currentPrices);
            setBaselineTime(new Date());
        }
        prevTokensRef.current = data;
        setNewTokenIds(newIds);
        setTokens(data);
        setLastUpdate(new Date());
        setError(null);
    }, []);

    // ── SSE 连接（优先，本地代理服务器运行时生效） ──────────────────────────
    useEffect(() => {
        let es;
        let retryTimer;

        function connect() {
            try {
                es = new EventSource(LOCAL_STREAM);

                es.onopen = () => {
                    setSseActive(true);
                    setLoading(false);
                    console.log("[SSE] 已连接，实时推送模式");
                };

                es.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        // 更新服务器统计（ping 和 data 都携带）
                        if (msg.fetchCount) setSseFetchCount(msg.fetchCount);
                        if (msg.changeCount !== undefined) setSseChangeCount(msg.changeCount);
                        setLastCheckTime(new Date());

                        if (msg.type === "data" && msg.success && msg.data) {
                            processTokenData(msg.data);
                            if (msg.stabilityMap) setStabilityMap(msg.stabilityMap);
                            setLoading(false);
                        } else if (msg.type === "stability" && msg.stabilityMap) {
                            // 订单簿价差独立推送
                            setStabilityMap(msg.stabilityMap);
                        }
                        // type === "ping" 时只更新检查时间
                    } catch (_) {}
                };

                es.onerror = () => {
                    es.close();
                    setSseActive(false);
                    // 3s 后尝试重连
                    retryTimer = setTimeout(connect, 3000);
                };
            } catch (_) {
                setSseActive(false);
            }
        }

        connect();
        return () => {
            es?.close();
            clearTimeout(retryTimer);
        };
    }, [processTokenData]);

    // ── 辅助数据（Top3/BNB价格），SSE 覆盖稳定度，这里只管 alpha123 数据 ──
    const fetchAuxData = useCallback(async () => {
        try {
            const result = await fetchAlpha123Data();
            setTop3(result.top3);
            setBnbPrice(result.bnbPrice);
        } catch (_) {}
    }, []);

    // 启动时拉辅助数据，之后每 60s 刷新一次
    useEffect(() => {
        fetchAuxData();
        const t = setInterval(fetchAuxData, 60_000);
        return () => clearInterval(t);
    }, [fetchAuxData]);

    // ── 降级轮询（仅在 SSE 未连接时启用） ──────────────────────────────────
    const fetchTokens = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const data = await fetchAlphaTokens();
            processTokenData(data);
        } catch (e) {
            setError(e.message || "获取代币数据失败");
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    }, [processTokenData]);

    useEffect(() => {
        if (sseActive) {
            // SSE 已接管，停止轮询定时器
            if (timerRef.current) clearInterval(timerRef.current);
            setCountdown(0);
            return;
        }
        // SSE 未连接，启动降级轮询
        if (timerRef.current) clearInterval(timerRef.current);
        countdownRef.current = refreshInterval;
        setCountdown(refreshInterval);
        // 立即拉一次
        fetchTokens();
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
    }, [sseActive, refreshInterval, fetchTokens]);

    // 过滤 + 排序
    const searchKey = search.trim().toLowerCase();
    const filtered = tokens
        .filter(t => filterMul === 0 ? true : (t.mulPoint || 1) >= filterMul)
        .filter(t => !searchKey || (t.symbol || "").toLowerCase().includes(searchKey))
        .sort((a, b) => {
            if (sortBy === "volume") return parseFloat(b.volume24h || 0) - parseFloat(a.volume24h || 0);
            if (sortBy === "mulPoint") return (b.mulPoint || 1) - (a.mulPoint || 1);
            if (sortBy === "change") return (parseFloat(b.percentChange24h) || 0) - (parseFloat(a.percentChange24h) || 0);
            if (sortBy === "marketCap") return parseFloat(b.marketCap || 0) - parseFloat(a.marketCap || 0);
            if (sortBy === "stability") {
                const order = { "green:stable": 0, "yellow:normal": 1, "yellow:moderate": 1, "red:unstable": 2, "red:no_trade": 3 };
                const sa = stabilityMap[a.symbol]?.stability;
                const sb = stabilityMap[b.symbol]?.stability;
                return (order[sa] ?? 9) - (order[sb] ?? 9);
            }
            return 0;
        });

    const mulCounts = {};
    tokens.forEach(t => {
        const m = t.mulPoint || 1;
        mulCounts[m] = (mulCounts[m] || 0) + 1;
    });

    const handleResetBaseline = () => {
        baselineSetRef.current = false;
        if (!sseActive) fetchTokens();
    };

    const handleRefresh = () => {
        if (!sseActive) {
            countdownRef.current = refreshInterval;
            setCountdown(refreshInterval);
            fetchTokens();
        }
    };

    return (
        <div style={{ minHeight: "100vh", background: "#0a0c10", color: "#e2e8f0" }}>
            <Header
                mulCounts={mulCounts}
                loading={loading}
                error={error}
                isRefreshing={isRefreshing}
                countdown={sseActive ? 0 : countdown}
                refreshInterval={refreshInterval}
                baselineTime={baselineTime}
                sseActive={sseActive}
                onIntervalChange={setRefreshInterval}
                onResetBaseline={handleResetBaseline}
                onRefresh={handleRefresh}
            />

            <Top3Bar top3={top3} bnbPrice={bnbPrice} />

            <FilterBar
                filterMul={filterMul}
                search={search}
                sortBy={sortBy}
                mulCounts={mulCounts}
                onFilterMul={setFilterMul}
                onSearch={setSearch}
                onSort={setSortBy}
            />

            {(lastUpdate || lastCheckTime) && (
                <div style={{ padding: "6px 32px", fontSize: 10, color: "#2d3748", borderBottom: "1px solid #1a1f2e", display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>共 {tokens.length} 个 · 显示 {filtered.length} 个</span>
                    {lastUpdate && <span>数据更新：{lastUpdate.toLocaleTimeString("zh-CN")}</span>}
                    {sseActive && lastCheckTime && (
                        <>
                            <span style={{ color: "#48bb7866" }}>最后检查：{lastCheckTime.toLocaleTimeString("zh-CN")}</span>
                            <span style={{ color: "#48bb7888" }}>
                                已检查 <b style={{ color: "#48bb78" }}>{sseFetchCount}</b> 次 · 数据变化 <b style={{ color: sseChangeCount > 0 ? "#F0B90B" : "#4a5568" }}>{sseChangeCount}</b> 次
                            </span>
                        </>
                    )}
                    {baselineTime && <span style={{ color: "#7dd3fc66" }}>基准：{baselineTime.toLocaleTimeString("zh-CN")}</span>}
                </div>
            )}

            {error && (
                <div style={{
                    margin: "20px 32px", padding: "12px 16px",
                    background: "#fc818120", border: "1px solid #fc818140",
                    borderRadius: 6, fontSize: 12, color: "#fc8181"
                }}>
                    ⚠ {error}
                    <div style={{ marginTop: 6, fontSize: 10, color: "#fc818180" }}>
                        本地代理服务器未启动？运行 <code>npm run server</code> 可获得实时推送
                    </div>
                </div>
            )}

            <TokenTable
                loading={loading}
                filtered={filtered}
                newTokenIds={newTokenIds}
                baselinePrices={baselinePrices}
                stabilityMap={stabilityMap}
            />
        </div>
    );
}
