export default function PulsingDot({ color }) {
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
