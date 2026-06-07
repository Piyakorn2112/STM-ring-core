import Link from "next/link";
import Showcase from "./components/Showcase";
import RandomRingGrid from "./components/RandomRingGrid";

export default function Home() {
  return (
    <main
      style={{
        flex: 1,
        minHeight: "100dvh",
        display: "flex",
        justifyContent: "center",
        padding: "40px 24px",
        background:
          "radial-gradient(120% 120% at 50% 38%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
      }}
    >
      <nav
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 10,
          display: "flex",
          gap: 10,
        }}
      >
        <Link
          href="/hero"
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "#5827E0",
            borderRadius: 10,
          }}
        >
          Hero ↗
        </Link>
        <Link
          href="/hero-grid"
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "#5827E0",
            borderRadius: 10,
          }}
        >
          Grid ↗
        </Link>
        <Link
          href="/letters"
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "#5827E0",
            borderRadius: 10,
          }}
        >
          Letters ↗
        </Link>
        <Link
          href="/grid-exporter"
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "#5827E0",
            borderRadius: 10,
          }}
        >
          Grid Export ↗
        </Link>
      </nav>

      <div
        style={{
          width: "100%",
          maxWidth: 1120,
          display: "grid",
          gap: 72,
          justifyItems: "center",
        }}
      >
        <Showcase />
        <RandomRingGrid />
      </div>
    </main>
  );
}
