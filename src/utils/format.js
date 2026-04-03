export function formatNum(n) {
    if (!n) return "—";
    const num = parseFloat(n);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
    return num.toFixed(4);
}

export function formatPrice(p) {
    if (!p) return "—";
    const num = parseFloat(p);
    if (num < 0.000001) return num.toExponential(3);
    if (num < 0.01) return num.toFixed(8);
    if (num < 1) return num.toFixed(6);
    return num.toFixed(4);
}
