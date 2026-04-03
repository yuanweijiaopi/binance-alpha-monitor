export default function FilterBar({
    filterMul,
    search,
    sortBy,
    mulCounts,
    onFilterMul,
    onSearch,
    onSort,
}) {
    return (
        <div style={{
            padding: "12px 32px", borderBottom: "1px solid #1a1f2e",
            display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap"
        }}>
            {/* Mul filter chips */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#4a5568" }}>倍数筛选：</span>
                {[0, 1, 2, 3, 4].map(m => (
                    <button key={m} className={`filter-chip ${filterMul === m ? "active" : ""}`}
                        onClick={() => onFilterMul(m)}>
                        {m === 0 ? "全部" : `≥${m}x`}
                        {m > 0 && (
                            <span style={{ marginLeft: 4, opacity: 0.6 }}>({
                                Object.entries(mulCounts)
                                    .filter(([k]) => Number(k) >= m)
                                    .reduce((s, [, v]) => s + v, 0)
                            })</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Search input */}
            <input
                type="text"
                placeholder="搜索代币..."
                value={search}
                onChange={e => onSearch(e.target.value)}
                style={{
                    background: "#1a1f2e", color: "#e2e8f0",
                    border: "1px solid #2d3748", borderRadius: 4,
                    padding: "5px 12px", fontSize: 12, fontFamily: "inherit",
                    outline: "none", width: 160,
                }}
            />

            {/* Sort buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <span style={{ fontSize: 11, color: "#4a5568" }}>排序：</span>
                {[
                    { key: "mulPoint", label: "倍数" },
                    { key: "volume", label: "成交量" },
                    { key: "change", label: "涨跌幅" },
                    { key: "marketCap", label: "市值" },
                    { key: "stability", label: "稳定度" },
                ].map(s => (
                    <button key={s.key} className={`sort-btn btn ${sortBy === s.key ? "active" : ""}`}
                        onClick={() => onSort(s.key)}>{s.label}</button>
                ))}
            </div>
        </div>
    );
}
