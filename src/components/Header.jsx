import PulsingDot from "./PulsingDot";

export default function Header({
    mulCounts,
    loading,
    error,
    isRefreshing,
    countdown,
    refreshInterval,
    baselineTime,
    sseActive,
    onIntervalChange,
    onResetBaseline,
    onRefresh,
}) {
    return (
        <div style={{
            padding: "24px 28px 18px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            background: "linear-gradient(180deg, rgba(10,12,16,0.98), rgba(10,12,16,0.9))",
            backdropFilter: "blur(10px)",
            zIndex: 10
        }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
                <div style={{
                    width: 44, height: 44, borderRadius: 14,
                    background: "linear-gradient(135deg, #F0B90B, #ff6b35 72%, #f43f5e)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, fontWeight: 700,
                    boxShadow: "0 10px 24px rgba(240, 185, 11, 0.24)"
                }}>α</div>
                <div>
                    <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 10,
                        padding: "5px 10px",
                        borderRadius: 999,
                        background: "rgba(240, 185, 11, 0.1)",
                        border: "1px solid rgba(240, 185, 11, 0.25)",
                        color: "#f0b90b",
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase"
                    }}>
                        Alpha Feed Console
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontFamily: "Space Grotesk, sans-serif", letterSpacing: -0.8 }}>
                        Binance Alpha Monitor
                    </div>
                    <div style={{ fontSize: 12, color: "#71829e", marginTop: 6, maxWidth: 520, lineHeight: 1.55 }}>
                        聚合 Binance Alpha 列表、本地稳定度估算和第三方参考稳定度，面向 4x 倍数追踪与快速筛选的监控台。
                    </div>
                </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 280 }}>
                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {Object.entries(mulCounts).sort((a, b) => b[0] - a[0]).map(([mul, count]) => (
                        <div key={mul} className="metric-card">
                            <div style={{
                                color: mul >= 4 ? "#F0B90B" : mul >= 2 ? "#68d391" : "#94a3b8",
                                fontWeight: 700, fontSize: 16
                            }}>{count}</div>
                            <div style={{ color: "#61718d", fontSize: 10, marginTop: 4 }}>{mul}x</div>
                        </div>
                    ))}
                </div>

                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 10,
                    flexWrap: "wrap"
                }}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 8, fontSize: 11,
                        padding: "9px 12px", borderRadius: 12,
                        border: `1px solid ${sseActive ? "#48bb7844" : "#4a556844"}`,
                        background: sseActive ? "#48bb7810" : "#4a556810",
                        minHeight: 38
                    }}>
                        {loading ? (
                            <span style={{ color: "#4a5568" }}>加载中...</span>
                        ) : error ? (
                            <>
                                <span style={{ color: "#fc8181", fontSize: 8 }}>●</span>
                                <span style={{ color: "#fc8181" }}>连接失败</span>
                            </>
                        ) : sseActive ? (
                            <>
                                <PulsingDot color="#48bb78" />
                                <span style={{ color: "#48bb78", fontWeight: 600 }}>实时推送</span>
                                <span style={{ color: "#48bb7855", fontSize: 10 }}>本地代理</span>
                            </>
                        ) : isRefreshing ? (
                            <>
                                <span className="spin" style={{ color: "#F0B90B", fontSize: 13 }}>↻</span>
                                <span style={{ color: "#F0B90B" }}>刷新中...</span>
                            </>
                        ) : (
                            <>
                                <PulsingDot color="#F0B90B" />
                                <span style={{ color: "#F0B90B" }}>轮询模式</span>
                                <span style={{ color: "#4a5568" }}>|</span>
                                <span style={{ color: "#94a3b8" }}>{countdown}s 后刷新</span>
                            </>
                        )}
                    </div>

                    <select
                        className="control-select"
                        value={refreshInterval}
                        onChange={e => onIntervalChange(Number(e.target.value))}
                        title={sseActive ? "实时推送模式下无需轮询，切换后生效于断线降级时" : ""}
                        style={{ color: sseActive ? "#56647e" : "#d7deea" }}
                    >
                        <option value={3}>3s 刷新</option>
                        <option value={5}>5s 刷新</option>
                        <option value={15}>15s 刷新</option>
                        <option value={30}>30s 刷新</option>
                        <option value={60}>1min 刷新</option>
                        <option value={180}>3min 刷新</option>
                    </select>

                    <button
                        onClick={onResetBaseline}
                        className="btn soft-btn"
                        style={{
                            color: "#7dd3fc",
                            borderColor: "#31546d",
                        }}
                        title={baselineTime ? `当前基准：${baselineTime.toLocaleTimeString("zh-CN")}` : ""}
                    >⊙ 重置基准</button>

                    {!sseActive && (
                        <button
                            disabled={isRefreshing}
                            onClick={onRefresh}
                            className="btn soft-btn"
                            style={{
                                color: isRefreshing ? "#5c6a83" : "#F0B90B",
                                borderColor: isRefreshing ? "#2d3748" : "#5a4d20",
                                cursor: isRefreshing ? "not-allowed" : "pointer"
                            }}
                        >{isRefreshing ? "↻ 刷新中..." : "↻ 立即刷新"}</button>
                    )}
                </div>
            </div>
        </div>
    );
}
