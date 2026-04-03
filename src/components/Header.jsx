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
            borderBottom: "1px solid #1e2533",
            padding: "20px 32px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            position: "sticky", top: 0, background: "#0a0c10", zIndex: 10
        }}>
            {/* Logo + Title */}
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
                {/* Mul Stats */}
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

                {/* 连接状态指示器 */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 11,
                    padding: "4px 10px", borderRadius: 6,
                    border: `1px solid ${sseActive ? "#48bb7844" : "#4a556844"}`,
                    background: sseActive ? "#48bb7810" : "#4a556810",
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
                            <span style={{ color: "#48bb78", fontWeight: 600 }}>⚡ 实时推送</span>
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

                {/* 刷新间隔（SSE 时灰显，仍可调供断线时使用） */}
                <select
                    value={refreshInterval}
                    onChange={e => onIntervalChange(Number(e.target.value))}
                    title={sseActive ? "实时推送模式下无需轮询，切换后生效于断线降级时" : ""}
                    style={{
                        background: "#1a1f2e",
                        color: sseActive ? "#2d3748" : "#94a3b8",
                        border: `1px solid ${sseActive ? "#1e2533" : "#2d3748"}`,
                        borderRadius: 4, padding: "4px 8px", fontSize: 11, fontFamily: "inherit",
                        cursor: "pointer", outline: "none",
                    }}
                >
                    <option value={3}>3s刷新</option>
                    <option value={5}>5s刷新</option>
                    <option value={15}>15s刷新</option>
                    <option value={30}>30s刷新</option>
                    <option value={60}>1min刷新</option>
                    <option value={180}>3min刷新</option>
                </select>

                {/* Reset baseline button */}
                <button
                    onClick={onResetBaseline}
                    className="btn"
                    style={{
                        background: "#1a1f2e", color: "#7dd3fc",
                        border: "1px solid #7dd3fc44",
                        borderRadius: 4, padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
                    }}
                    title={baselineTime ? `当前基准：${baselineTime.toLocaleTimeString("zh-CN")}` : ""}
                >⊙ 重置基准</button>

                {/* 手动刷新（仅轮询模式下可用） */}
                {!sseActive && (
                    <button
                        disabled={isRefreshing}
                        onClick={onRefresh}
                        className="btn"
                        style={{
                            background: isRefreshing ? "#111520" : "#1a1f2e",
                            color: isRefreshing ? "#4a5568" : "#F0B90B",
                            border: `1px solid ${isRefreshing ? "#2d374844" : "#F0B90B44"}`,
                            borderRadius: 4, padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
                            cursor: isRefreshing ? "not-allowed" : "pointer"
                        }}
                    >{isRefreshing ? "↻ 刷新中..." : "↻ 立即刷新"}</button>
                )}
            </div>
        </div>
    );
}
