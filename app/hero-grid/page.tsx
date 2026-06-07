import Link from "next/link";
import HeroGrid from "../components/HeroGrid";

export default function HeroGridPage() {
  return (
    <section
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
      }}
    >
      <HeroGrid />

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
