import { useState } from "react";
import { formatNum, formatPrice } from "../utils/format";

const CHAIN_COLORS = {
    BSC: "#F0B90B",
    ETH: "#627EEA",
    Base: "#0052FF",
    SOL: "#9945FF",
};

const STABILITY_CONFIG = {
    "green:stable":   { label: "稳定",   color: "#48bb78", bg: "#48bb7820" },
    "yellow:normal":  { label: "一般",   color: "#F0B90B", bg: "#F0B90B20" },
    "yellow:moderate":{ label: "一般",   color: "#F0B90B", bg: "#F0B90B20" },
    "red:unstable":   { label: "不稳",   color: "#fc8181", bg: "#fc818120" },
    "red:no_trade":   { label: "无成交", color: "#4a5568", bg: "#4a556820" },
};

function classifyByLocalChange(changePercent) {
    const abs = Math.abs(parseFloat(changePercent) || 0);
    if (abs < 3) return "green:stable";
    if (abs < 10) return "yellow:normal";
    if (abs < 25) return "yellow:moderate";
    return "red:unstable";
}

function TokenIcon({ iconUrl, symbol, mulColor }) {
    const [imgError, setImgError] = useState(false);
    if (iconUrl && !imgError) {
        return (
            <img src={iconUrl} alt="" onError={() => setImgError(true)}
                style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${mulColor}44` }} />
        );
    }
    return (
        <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: mulColor + "33", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 10, color: mulColor
        }}>{(symbol || "?")[0].toUpperCase()}</div>
    );
}

function StabilityBadge({ st }) {
    if (!st) return <span style={{ color: "#2d3748", fontSize: 11 }}>—</span>;
    const cfg = STABILITY_CONFIG[st] || { label: st, color: "#94a3b8", bg: "#94a3b820" };
    return (
        <span style={{
            background: cfg.bg, color: cfg.color,
            border: `1px solid ${cfg.color}55`,
            padding: "2px 10px", borderRadius: 20,
            fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
        }}>{cfg.label}</span>
    );
}

function LocalMetricCell({ token, stabInfo }) {
    if (stabInfo?.spread != null) {
        return (
            <span style={{ color: stabInfo.spread < 1 ? "#48bb78" : stabInfo.spread < 3 ? "#F0B90B" : "#fc8181" }}>
                {stabInfo.spread.toFixed(4)} bps
            </span>
        );
    }

    const chg = parseFloat(token.percentChange24h);
    if (isNaN(chg)) return <span style={{ color: "#2d3748" }}>—</span>;

    const abs = Math.abs(chg);
    const col = abs < 3 ? "#48bb7888" : abs < 10 ? "#F0B90B88" : "#fc818188";
    return (
        <span style={{ color: col, fontSize: 11 }}>
            {abs.toFixed(2)}%<span style={{ fontSize: 9, marginLeft: 2, opacity: 0.6 }}>vol</span>
        </span>
    );
}

function ReferenceMetricCell({ refInfo }) {
    if (!refInfo) return <span style={{ color: "#4a5568", fontSize: 11 }}>未收录</span>;
    if (refInfo.spread == null || refInfo.spread === "-") {
        return <span style={{ color: "#2d3748" }}>—</span>;
    }

    const spread = parseFloat(refInfo.spread);
    if (isNaN(spread)) return <span style={{ color: "#2d3748" }}>—</span>;

    return (
        <span style={{ color: spread < 1 ? "#48bb78" : spread < 3 ? "#F0B90B" : "#fc8181" }}>
            {spread.toFixed(4)} bps
        </span>
    );
}

// 展开后的详情面板
function DetailPanel({ token, stabInfo, referenceStabInfo, baselinePrices }) {
    const curPrice = parseFloat(token.price);
    const basePrice = baselinePrices[token.alphaId];
    const baseChange = (!isNaN(curPrice) && curPrice > 0 && basePrice > 0)
        ? (curPrice - basePrice) / basePrice * 100 : null;
    const change = token.percentChange24h != null ? parseFloat(token.percentChange24h) : null;
    const localStability = stabInfo?.stability || (
        token.percentChange24h != null ? classifyByLocalChange(token.percentChange24h) : null
    );

    const items = [
        {
            label: "价格",
            value: <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>${formatPrice(curPrice)}</span>,
        },
        {
            label: "基准变化",
            value: baseChange === null ? "—"
                : Math.abs(baseChange) < 0.0001 ? <span style={{ color: "#4a5568" }}>±0.00%</span>
                : <span style={{ color: baseChange >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>
                    {baseChange >= 0 ? "▲" : "▼"} {Math.abs(baseChange) < 0.01
                        ? Math.abs(baseChange).toFixed(4) : Math.abs(baseChange).toFixed(2)}%
                  </span>,
        },
        {
            label: "24h 涨跌",
            value: change === null ? "—"
                : <span style={{ color: change >= 0 ? "#68d391" : "#fc8181" }}>
                    {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                  </span>,
        },
        {
            label: "本地稳定度",
            value: <StabilityBadge st={localStability} />,
        },
        {
            label: "本地 BPS / VOL",
            value: <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>
                <LocalMetricCell token={token} stabInfo={stabInfo} />
            </span>,
        },
        {
            label: "24h 成交量",
            value: <span style={{ color: "#94a3b8" }}>${formatNum(token.volume24h)}</span>,
        },
        {
            label: "市值",
            value: <span style={{ color: "#94a3b8" }}>${formatNum(token.marketCap)}</span>,
        },
        {
            label: "持有人",
            value: <span style={{ color: "#94a3b8" }}>{parseInt(token.holders || 0, 10).toLocaleString()}</span>,
        },
        {
            label: "第三方 4倍天数",
            value: referenceStabInfo?.mul4Days != null && referenceStabInfo.mul4Days !== "-"
                ? <span style={{ color: referenceStabInfo.mul4Days >= 20 ? "#F0B90B" : "#94a3b8", fontWeight: referenceStabInfo.mul4Days >= 20 ? 700 : 400 }}>
                    {referenceStabInfo.mul4Days}d
                  </span>
                : <span style={{ color: "#2d3748" }}>—</span>,
        },
    ];

    return (
        <tr>
            <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid #111520" }}>
                <div style={{
                    display: "flex", flexWrap: "wrap", gap: 0,
                    background: "#0d1117",
                    borderTop: "1px solid #1e2533",
                    padding: "14px 24px 14px 72px",
                    animation: "fadeIn 0.15s ease",
                }}>
                    {items.map(({ label, value }) => (
                        <div key={label} style={{
                            minWidth: 140, padding: "4px 16px 4px 0",
                        }}>
                            <div style={{ fontSize: 9, color: "#4a5568", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                                {label}
                            </div>
                            <div style={{ fontSize: 13 }}>{value}</div>
                        </div>
                    ))}
                </div>
            </td>
        </tr>
    );
}

export default function TokenTable({ loading, filtered, newTokenIds, baselinePrices, stabilityMap, referenceStabilityMap }) {
    const [expandedId, setExpandedId] = useState(null);

    const HEADERS = ["代币", "链", "积分倍数", "第三方参考", ""];

    const toggle = (id) => setExpandedId(prev => prev === id ? null : id);

    return (
        <div className="token-table-wrap">
            <div className="token-table-shell">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                    <tr className="table-header-row" style={{ borderBottom: "1px solid #1e2533" }}>
                        {HEADERS.map((h, i) => (
                            <th key={i} style={{
                                padding: "14px 12px", textAlign: "left",
                                fontSize: 10, color: "#71829e", fontWeight: 500,
                                letterSpacing: "0.08em", textTransform: "uppercase",
                                whiteSpace: "nowrap",
                            }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading && filtered.length === 0 ? (
                        <tr><td colSpan={5} style={{ textAlign: "center", padding: 60, color: "#4a5568" }}>
                            <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
                            <div>正在获取币安 Alpha 数据...</div>
                        </td></tr>
                    ) : filtered.length === 0 ? (
                        <tr><td colSpan={5} style={{ textAlign: "center", padding: 60, color: "#4a5568" }}>
                            <div style={{ fontSize: 24, marginBottom: 8 }}>○</div>
                            <div>暂无符合条件的代币</div>
                        </td></tr>
                    ) : filtered.map((token, i) => {
                        const mul = token.mulPoint || 1;
                        const isNew = newTokenIds.has(token.alphaId);
                        const mulColor = mul >= 4 ? "#F0B90B" : mul >= 3 ? "#fbb040" : mul >= 2 ? "#68d391" : "#4a5568";
                        const chainColor = CHAIN_COLORS[token.chainName] || "#64748b";
                        const stabInfo = stabilityMap[token.symbol] || null;
                        const referenceStabInfo = referenceStabilityMap[token.symbol] || null;
                        const isExpanded = expandedId === token.alphaId;

                        return [
                            <tr key={token.alphaId}
                                className="token-row"
                                onClick={() => toggle(token.alphaId)}
                                style={{
                                    borderBottom: isExpanded ? "none" : "1px solid #111520",
                                    background: isExpanded ? "#0d1117" : isNew ? "#F0B90B08" : i % 2 === 0 ? "transparent" : "#0d0f18",
                                    cursor: "pointer",
                                }}>
                                {/* 代币 */}
                                <td style={{ padding: "10px 12px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <TokenIcon iconUrl={token.iconUrl} symbol={token.symbol} mulColor={mulColor} />
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

                                {/* 链 */}
                                <td style={{ padding: "10px 12px" }}>
                                    <span style={{
                                        background: chainColor + "22", color: chainColor,
                                        padding: "2px 8px", borderRadius: 4, fontSize: 10,
                                        border: `1px solid ${chainColor}44`, fontWeight: 500
                                    }}>{token.chainName || "—"}</span>
                                </td>

                                {/* 积分倍数 */}
                                <td style={{ padding: "10px 12px" }}>
                                    <div style={{
                                        background: mulColor + "22", color: mulColor,
                                        border: `1px solid ${mulColor}66`,
                                        borderRadius: 6, padding: "4px 12px",
                                        fontSize: 15, fontWeight: 700, display: "inline-block"
                                    }}>{mul}x</div>
                                </td>

                                {/* 第三方参考 */}
                                <td style={{ padding: "10px 12px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        {referenceStabInfo
                                            ? <StabilityBadge st={referenceStabInfo.stability} />
                                            : <span style={{ color: "#4a5568", fontSize: 11 }}>未收录</span>}
                                        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}>
                                            <ReferenceMetricCell refInfo={referenceStabInfo} />
                                        </span>
                                    </div>
                                </td>

                                {/* 展开箭头 */}
                                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                                    <span style={{
                                        color: "#2d3748", fontSize: 12,
                                        display: "inline-block",
                                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                                        transition: "transform 0.2s ease",
                                    }}>▾</span>
                                </td>
                            </tr>,

                            isExpanded && (
                                <DetailPanel
                                    key={`${token.alphaId}-detail`}
                                    token={token}
                                    stabInfo={stabInfo}
                                    referenceStabInfo={referenceStabInfo}
                                    baselinePrices={baselinePrices}
                                />
                            ),
                        ];
                    })}
                </tbody>
            </table>
            </div>
        </div>
    );
}
