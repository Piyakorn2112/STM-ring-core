"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { exportThumbnailSVG, VIEW_H, VIEW_W } from "../components/stmRingCore";

const RING = 96; // px per character ring
const SEG = 200; // a touch cheaper than full quality (clean 4:1 ratio)
const PIECES = 50;

const dataUrl = (svg: string) =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

export default function LettersPage() {
  const [text, setText] = useState("");

  // One deterministic static ring per character, cached by character so the
  // same letter is only ever generated once.
  const cache = useRef<Map<string, string>>(new Map());
  const ringFor = (ch: string) => {
    let url = cache.current.get(ch);
    if (!url) {
      url = dataUrl(exportThumbnailSVG(ch, RING, false, SEG, PIECES));
      cache.current.set(ch, url);
    }
    return url;
  };

  // Each visible character becomes one ring (whitespace is skipped).
  const chars = Array.from(text).filter((ch) => ch.trim() !== "");

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      }}
    >
      {/* LEFT — text field */}
      <div
        style={{
          width: "38%",
          minWidth: 300,
          maxWidth: 520,
          height: "100%",
          padding: "44px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          background: "#fff",
          borderRight: "1px solid #e6e6e3",
        }}
      >
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: "#5827E0" }}>
          ← Back
        </Link>
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "#18181b",
            }}
          >
            One ring per character
          </h1>
          <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.6, color: "#71717a" }}>
            Type anything. Each character is hashed into its own deterministic
            ring — the same letter always makes the same shape.
          </p>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a name…"
          autoFocus
          spellCheck={false}
          style={{
            flex: 1,
            resize: "none",
            padding: "16px 18px",
            fontSize: 18,
            lineHeight: 1.6,
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            color: "#18181b",
            background: "#fafafa",
            border: "1px solid #d4d4d8",
            borderRadius: 14,
            outline: "none",
          }}
        />
        <div
          style={{
            fontSize: 12,
            color: "#a1a1aa",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {chars.length} ring{chars.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* RIGHT — grid of per-character rings */}
      <div
        style={{
          flex: 1,
          height: "100%",
          overflow: "auto",
          padding: 32,
          background:
            "radial-gradient(120% 120% at 50% 38%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
        }}
      >
        {chars.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: "#a1a1aa",
              fontSize: 14,
            }}
          >
            Start typing on the left…
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${RING + 28}px, 1fr))`,
              gap: 16,
              alignContent: "start",
            }}
          >
            {chars.map((ch, i) => (
              <div key={i} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: RING,
                    height: (RING * VIEW_H) / VIEW_W,
                    backgroundImage: ringFor(ch),
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    backgroundSize: "contain",
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    color: "#52525b",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {ch}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
