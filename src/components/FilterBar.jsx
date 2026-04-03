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
        <div className="toolbar-card" style={{ padding: "16px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#6f7f9a", whiteSpace: "nowrap" }}>倍数筛选</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 220 }}>
                    <span style={{ fontSize: 11, color: "#6f7f9a", whiteSpace: "nowrap" }}>搜索</span>
                    <input
                        className="control-input"
                        type="text"
                        placeholder="输入 symbol..."
                        value={search}
                        onChange={e => onSearch(e.target.value)}
                        style={{ width: "100%" }}
                    />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#6f7f9a", whiteSpace: "nowrap" }}>排序</span>
                    {[
                        { key: "mulPoint", label: "倍数" },
                        { key: "volume", label: "成交量" },
                        { key: "change", label: "涨跌幅" },
                        { key: "marketCap", label: "市值" },
                        { key: "stability", label: "第三方稳定度" },
                    ].map(s => (
                        <button
                            key={s.key}
                            className={`sort-btn btn soft-btn ${sortBy === s.key ? "active" : ""}`}
                            onClick={() => onSort(s.key)}
                        >{s.label}</button>
                    ))}
                </div>
            </div>
        </div>
    );
}
