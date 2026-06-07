import Link from "next/link";
import HeroBackground from "../components/HeroBackground";
import StmFullLogo from "../components/StmFullLogo";

export default function HeroPage() {
  return (
    <section
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
      }}
    >
      <HeroBackground />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
        }}
      >
        <StmFullLogo width={260} />
      </div>

      <Link
        href="/"
        style={{
          position: "absolute",
          top: 24,
          left: 24,
          padding: "10px 18px",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.02em",
          color: "#fff",
          background: "#111",
          border: "none",
          borderRadius: 10,
        }}
      >
        ← Back
      </Link>
    </section>
  );
}
