"use client";

import { useState } from "react";
import StmRing from "./StmRing";
import { exportSVG, N_EXPORT } from "./stmRingCore";

export default function Showcase() {
  const [seed, setSeed] = useState("");
  const [grayscale, setGrayscale] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [animateColor, setAnimateColor] = useState(false);
  const s = seed.trim();

  // Download the *deterministic* SVG for the current seed (twisted) — or the
  // plain grey mark when the seed box is empty. High segment count for crispness.
  const download = () => {
    const svg = exportSVG({
      id: s || undefined,
      morph: s ? 1 : 0,
      segments: N_EXPORT,
      size: 512,
      grayscale,
    });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = s ? `stm-ring-${s.replace(/[^a-z0-9_-]+/gi, "_")}.svg` : "stm-ring.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "grid", placeItems: "center", gap: 26 }}>
      <StmRing
        size={360}
        forceSeed={s || null}
        grayscale={grayscale}
        animate={animate}
        animateColor={animateColor}
      />

      <div
        style={{
          fontWeight: 600,
          letterSpacing: "0.34em",
          fontSize: 13,
          color: "#2b2b2b",
          paddingLeft: "0.34em",
        }}
      >
        SRANG TECH MAI
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="seed — empty = live"
          aria-label="Seed to force a shape"
          spellCheck={false}
          autoComplete="off"
          style={{
            width: 230,
            padding: "10px 14px",
            fontSize: 13,
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            color: "#18181b",
            background: "#fff",
            border: "1px solid #d4d4d8",
            borderRadius: 10,
            outline: "none",
          }}
        />
        <button
          onClick={download}
          style={{
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "#111",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          Download SVG
        </button>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            color: "#52525b",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={grayscale}
            onChange={(e) => setGrayscale(e.target.checked)}
          />
          Grayscale
        </label>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            color: "#52525b",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={animate}
            onChange={(e) => {
              setAnimate(e.target.checked);
              if (e.target.checked) setAnimateColor(false);
            }}
          />
          Animate
        </label>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            color: "#52525b",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={animateColor}
            onChange={(e) => {
              setAnimateColor(e.target.checked);
              if (e.target.checked) setAnimate(false);
            }}
          />
          Animate color
        </label>
      </div>

      <p
        style={{
          margin: 0,
          maxWidth: 420,
          textAlign: "center",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "#71717a",
        }}
      >
        Type a seed (e.g. an employee ID) to lock its shape; leave it empty to
        play live and hover the ring to shuffle twists. Tick Animate to let the
        wire flow on its own, morphing endlessly between random seeds.
      </p>
    </div>
  );
}
