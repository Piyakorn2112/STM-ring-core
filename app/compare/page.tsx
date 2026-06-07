import StmRing from "../components/StmRing";

const SIZE = 320;

export default function Compare() {
  return (
    <main
      style={{
        flex: 1,
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        background:
          "radial-gradient(120% 120% at 50% 38%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
      }}
    >
      <div style={{ display: "grid", gap: 28, justifyItems: "center" }}>
        <h1
          style={{
            fontWeight: 600,
            letterSpacing: "0.06em",
            fontSize: 18,
            color: "#222",
            margin: 0,
          }}
        >
          Original&nbsp;·&nbsp;Recreated
        </h1>
        <div
          style={{
            display: "flex",
            gap: 56,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Panel label="Original SVG">
            {/* The untouched source file, served from /public */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/stm-original.svg"
              alt="Original STM ring"
              width={SIZE}
              height={(SIZE * 171) / 176}
              style={{ display: "block" }}
            />
          </Panel>
          <Panel label="Recreated (live — hover to twist)">
            <StmRing size={SIZE} />
          </Panel>
        </div>
        <p style={{ color: "#666", fontSize: 13, maxWidth: 560, textAlign: "center", lineHeight: 1.6 }}>
          Same centre, radii and gradient as the source. The recreation morphs
          its centre-line continuously and eases into a seed-based twist while
          hovered — always staying inside the original square footprint.
        </p>
      </div>
    </main>
  );
}

function Panel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <figure style={{ margin: 0, display: "grid", gap: 14, justifyItems: "center" }}>
      <div
        style={{
          padding: 18,
          borderRadius: 18,
          background: "#ffffff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 12px 30px rgba(0,0,0,0.06)",
        }}
      >
        {children}
      </div>
      <figcaption style={{ color: "#555", fontSize: 13, letterSpacing: "0.02em" }}>
        {label}
      </figcaption>
    </figure>
  );
}
