import { formatNum } from "../utils/format";

function TradeCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e4) return Math.round(n / 1e4) + "万";
    return n.toLocaleString();
}

export default function Top3Bar({ top3, bnbPrice }) {
    if (!top3 || top3.length === 0) return null;

    return (
        <div className="panel-section" style={{
            padding: "14px 24px",
            display: "flex", alignItems: "center", gap: 18,
            flexWrap: "wrap",
            background: "linear-gradient(180deg, rgba(13, 18, 28, 0.98), rgba(11, 15, 23, 0.92))",
        }}>
            <span style={{
                fontSize: 10,
                color: "#7a8cab",
                whiteSpace: "nowrap",
                textTransform: "uppercase",
                letterSpacing: "0.14em"
            }}>今日 Top3</span>

            <div style={{ display: "flex", gap: 20, flex: 1, flexWrap: "wrap" }}>
                {top3.map((t, i) => (
                    <div key={t.symbol} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderRadius: 12,
                        background: "rgba(17, 23, 34, 0.88)",
                        border: "1px solid rgba(43, 53, 73, 0.9)"
                    }}>
                        <span style={{
                            width: 18, height: 18, borderRadius: "50%",
                            background: i === 0 ? "#F0B90B" : i === 1 ? "#94a3b8" : "#8B6914",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 9, fontWeight: 700, color: "#0a0c10", flexShrink: 0,
                        }}>{i + 1}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{t.symbol}</span>
                        <span style={{ fontSize: 11, color: "#4a5568" }}>
                            {TradeCount(t.trades)}次买入
                        </span>
                        <span style={{
                            fontSize: 11, color: "#7dd3fc",
                            background: "#7dd3fc11", padding: "1px 6px",
                            borderRadius: 4, border: "1px solid #7dd3fc22",
                        }}>均${parseFloat(t.avgBuyAmount).toFixed(0)}</span>
                    </div>
                ))}
            </div>

            {bnbPrice && (
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexShrink: 0,
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: "rgba(17, 23, 34, 0.88)",
                    border: "1px solid rgba(43, 53, 73, 0.9)"
                }}>
                    <span style={{ fontSize: 10, color: "#7a8cab" }}>BNB</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#F0B90B" }}>
                        ${parseFloat(bnbPrice).toFixed(1)}
                    </span>
                </div>
            )}
        </div>
    );
}
