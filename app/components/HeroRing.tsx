"use client";

/**
 * HeroRing — the company ring blown up far past the viewport so only a slice of
 * it shows, rendered grayscale and blended into the solid purple hero field.
 *
 *  • A fresh random seed is chosen on every page load (after mount, to avoid an
 *    SSR/CSR hydration mismatch); the ring blooms out of rest into that shape
 *    and stays alive via the renderer's own spin / breathe / charge drift.
 *  • The whole ring slowly DRIFTS and ROTATES. The drift follows a low-harmonic
 *    orbit — a base circle plus a single knob-2 epicycle (knob ≤ 2) — the same
 *    curve language as the company ring's own centre-line, so the motion reads
 *    as "travelling along the invisible company ring".
 *  • mix-blend-mode: multiply is the web-standard stand-in for Photoshop's
 *    "Linear Burn" (no CSS linear-burn exists); over the grayscale ring it burns
 *    the dark wire into the purple field just like linear burn would.
 *
 * Honours prefers-reduced-motion: the external drift/rotation is frozen (the
 * renderer itself already stops its own animation under that preference).
 */

import { useEffect, useRef, useState } from "react";
import StmRing from "./StmRing";
import { randomSeed } from "./stmRingCore";

export default function HeroRing({ shapeKey = 0 }: { shapeKey?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [size, setSize] = useState(2400);
  // Per-load motion signature so no two visits drift identically.
  const orbit = useRef({ ph: 0, rotDir: 1, rotSpeed: 3, w: 0.06, a2: 0.4 });

  // New random shape on mount AND whenever shapeKey changes (the 16s tick). The
  // StmRing glides to it; the motion signature below stays fixed so rotation
  // speed never jumps.
  useEffect(() => {
    setSeed(String(randomSeed()));
  }, [shapeKey]);

  // Pick the drift/rotation signature once, on the client only.
  useEffect(() => {
    orbit.current = {
      ph: Math.random() * Math.PI * 2,
      rotDir: Math.random() < 0.5 ? -1 : 1,
      rotSpeed: 2 + Math.random() * 3, // deg / s
      w: 0.05 + Math.random() * 0.04, // rad / s along the orbit
      a2: 0.3 + Math.random() * 0.25, // relative size of the knob-2 lobe
    };
  }, []);

  // Oversize the ring relative to the viewport so it always overflows the frame.
  useEffect(() => {
    const resize = () =>
      setSize(Math.max(window.innerWidth, window.innerHeight) * 1.2);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Continuously shift position (along the knob-≤2 orbit) and rotation.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const { ph, rotDir, rotSpeed, w, a2 } = orbit.current;
      const R = Math.min(window.innerWidth, window.innerHeight) * 0.14;
      // base circle (knob 1) + one knob-2 epicycle — highest knob is 2.
      const ox = R * (Math.cos(w * t) + a2 * Math.cos(2 * w * t + ph));
      const oy = R * (Math.sin(w * t) + a2 * Math.sin(2 * w * t + ph));
      const rot = rotDir * rotSpeed * t;
      const el = wrapRef.current;
      if (el) {
        el.style.transform = `translate(-50%,-50%) translate(${ox.toFixed(
          2,
        )}px,${oy.toFixed(2)}px) rotate(${rot.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        // Closest standard blend to Photoshop "Linear Burn" (no CSS equivalent).
        mixBlendMode: "multiply",
        willChange: "transform",
        pointerEvents: "none",
        filter: "invert(1)"
      }}
    >
      {/* Decorative, oversized and blended — detail is invisible here, so run it
          cheap: fewer strands and a capped frame rate. The core/showcase ring is
          unaffected (it uses the defaults). */}
      <StmRing
        size={size}
        forceSeed={seed}
        grayscale
        segments={110}
        pieces={64}
        fps={45}
      />
    </div>
  );
}
