"use client";

/**
 * /code — preview the STM ring-code generator. Type a payload id, see it drawn
 * as the dashed "dust of the ring" with its orange fiducial, and confirm it
 * round-trips back to the same id through the codec. Purely a viewer over
 * `ringCodeCore` — no core engine code here.
 */

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  buildCodeRing,
  decodeFrame,
  N_SLOTS,
  PAYLOAD_BITS,
  renderCodeRingSVG,
  SYMBOL_COUNT,
} from "../components/ringCodeCore";

const MAX_ID = 2 ** PAYLOAD_BITS - 1;
const dataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

type ColorChoice = "ring" | "mono" | "grayscale";

export default function CodePage() {
  const [raw, setRaw] = useState("12345");
  const [transparent, setTransparent] = useState(false);
  const [color, setColor] = useState<ColorChoice>("ring");
  const [monoHex, setMonoHex] = useState("#111111");

  // Clamp to a valid payload; defer so dragging the slider stays smooth (the
  // build runs a deterministic seed-search, ~tens of ms).
  const payload = Math.max(0, Math.min(MAX_ID, Math.floor(Number(raw) || 0)));
  const dPayload = useDeferredValue(payload);
  const dTransparent = useDeferredValue(transparent);
  const dColor = useDeferredValue(color);
  const dMonoHex = useDeferredValue(monoHex);

  const { svg, stats } = useMemo(() => {
    const ring = buildCodeRing(dPayload);
    const dataSymbols = ring.glyphs.filter((g) => g.data).map((g) => g.symbol);
    const decoded = decodeFrame(dataSymbols);
    return {
      svg: renderCodeRingSVG(ring, {
        size: 512,
        background: dTransparent ? undefined : "#ffffff",
        mono: dColor === "mono" ? dMonoHex : undefined,
        grayscale: dColor === "grayscale",
      }),
      stats: {
        decoded: decoded.payload,
        ok: decoded.payload === dPayload,
        usable: ring.dataSlots.length,
        seedK: ring.seedK,
        crossings: ring.kinds.filter((k) => k === "keepout").length,
      },
    };
  }, [dPayload, dTransparent, dColor, dMonoHex]);

  const stale =
    dPayload !== payload || dTransparent !== transparent || dColor !== color || dMonoHex !== monoHex;

  const download = () => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stm-code-${payload}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const chip = (label: string, value: string, good?: boolean) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "8px 12px",
        background: "#fff",
        border: "1px solid #e6e6ea",
        borderRadius: 10,
        minWidth: 86,
      }}
    >
      <span style={{ fontSize: 10.5, color: "#a1a1aa", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "var(--font-geist-mono), monospace",
          color: good === undefined ? "#18181b" : good ? "#16a34a" : "#dc2626",
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 26,
        padding: "40px 24px 80px",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        background: "radial-gradient(120% 120% at 50% 32%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
      }}
    >
      <div style={{ position: "fixed", top: 20, left: 20 }}>
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: "#5827E0" }}>
          ← Back
        </Link>
      </div>

      <div style={{ textAlign: "center", maxWidth: 540 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", color: "#18181b", margin: 0 }}>
          Ring-code
        </h1>
        <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.6, color: "#71717a" }}>
          The ring drawn as dashes that encode an id — the orange comet marks the
          start &amp; winding. Built on the same engine; it round-trips back to the id.
        </p>
      </div>

      {/* the code-ring */}
      <div
        aria-hidden="true"
        style={{
          width: 360,
          height: 350,
          display: "grid",
          placeItems: "center",
          opacity: stale ? 0.6 : 1,
          transition: "opacity 0.15s",
          background: transparent
            ? "repeating-conic-gradient(#e9e9e6 0% 25%, #f6f6f4 0% 50%) 50% / 22px 22px"
            : "transparent",
          borderRadius: 14,
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl(svg)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>

      {/* stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {chip("Decodes to", String(stats.decoded), stats.ok)}
        {chip("Usable slots", `${stats.usable}/${N_SLOTS}`)}
        {chip("Frame needs", `${SYMBOL_COUNT} sym`)}
        {chip("Keep-outs", String(stats.crossings))}
        {chip("Seed k", String(stats.seedK))}
      </div>

      {/* controls */}
      <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="number"
            min={0}
            max={MAX_ID}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            aria-label="Payload id"
            style={{
              width: 120,
              padding: "10px 13px",
              fontSize: 14,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              color: "#18181b",
              background: "#fff",
              border: "1px solid #d4d4d8",
              borderRadius: 10,
              outline: "none",
            }}
          />
          <input
            type="range"
            min={0}
            max={MAX_ID}
            value={payload}
            onChange={(e) => setRaw(e.target.value)}
            style={{ flex: 1, accentColor: "#5827E0" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: "#f4f4f5", padding: 4, borderRadius: 10 }}>
            {(["ring", "mono", "grayscale"] as ColorChoice[]).map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  padding: "7px 13px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  textTransform: "capitalize",
                  color: color === c ? "#fff" : "#52525b",
                  background: color === c ? "#111" : "transparent",
                }}
              >
                {c === "ring" ? "Ring color" : c}
              </button>
            ))}
          </div>
          {color === "mono" && (
            <input
              type="color"
              value={monoHex}
              onChange={(e) => setMonoHex(e.target.value)}
              aria-label="Mono color"
              style={{ width: 38, height: 34, border: "1px solid #d4d4d8", borderRadius: 9, background: "#fff" }}
            />
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={() => setRaw(String(Math.floor(Math.random() * (MAX_ID + 1))))}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: 600,
              color: "#3f3f46",
              background: "#f4f4f5",
              border: "1px solid #d4d4d8",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            ⟳ Random id
          </button>
          <button
            onClick={download}
            style={{
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "#fff",
              background: "#111",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            Download SVG ↓
          </button>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "#52525b",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            Transparent
          </label>
        </div>
        <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: "#a1a1aa" }}>
          id range 0–{MAX_ID.toLocaleString()} · v1 (overt tier, Hamming ECC)
        </p>
      </div>
    </main>
  );
}
