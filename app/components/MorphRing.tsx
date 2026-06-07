"use client";

/**
 * MorphRing — a one-shot, finite morph between two SETTLED shapes (seed A → B),
 * for the grid hero. It is a completely separate path from StmRing's `animate`
 * mode: it pulls ONLY the geometry-morph math (buildRingMorph) at a fixed
 * settled pose, with no spin/breathe/seed-cycling.
 *
 * The key property: at blend 0 it is byte-for-byte seed A's static thumbnail,
 * and at blend 1 byte-for-byte seed B's — because it uses the SAME settled pose
 * and segment/piece counts as exportThumbnailSVG. So a cell can go
 * static(A) → morph → static(B) with no pop at either end.
 */

import { useEffect, useId, useMemo, useRef } from "react";
import {
  VIEW_W,
  VIEW_H,
  CY,
  GRAD_X1,
  GRAD_X2,
  DARK_BASE,
  WHITE_BASE_OPACITY,
  STROKE,
  buildRingMorph,
  makeHover,
} from "./stmRingCore";

// Settled pose — MUST match exportThumbnailSVG so the morph endpoints equal the
// static thumbnails exactly (seamless static → morph → static).
const SETTLE_T = 10;
const SETTLE_TAU = 0.22;
const SETTLE_PROGRESS = 1 - Math.exp(-SETTLE_T / SETTLE_TAU);
const SETTLE_MORPH = SETTLE_PROGRESS;
const SETTLE_TWISTT = SETTLE_T - SETTLE_TAU * SETTLE_PROGRESS;

// Same transition curve as StmRing's animate variant: smoothstep into a gentle
// overshoot (easeOutBack, c1 = 0.6) that settles back to exactly 1.
const backOut = (t: number) => {
  const c1 = 0.6;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

const f2 = (v: number) => v.toFixed(2);

export default function MorphRing({
  seedA,
  seedB,
  size,
  segments,
  pieces,
  durationMs = 1300,
  grayscale = false,
  white = false,
  onDone,
}: {
  seedA: number | string;
  seedB: number | string;
  size: number;
  segments: number;
  pieces: number;
  durationMs?: number;
  grayscale?: boolean;
  white?: boolean;
  onDone?: () => void;
}) {
  const baseRef = useRef<SVGPathElement>(null);
  const bodyRefs = useRef<(SVGPathElement | null)[]>([]);
  const gradRefs = useRef<(SVGLinearGradientElement | null)[]>([]);
  const stopRefs = useRef<(SVGStopElement | null)[][]>([]);
  const uid = useId().replace(/:/g, "");

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const hoverA = useMemo(() => makeHover(seedA), [seedA]);
  const hoverB = useMemo(() => makeHover(seedB), [seedB]);

  // blend 0 ⇒ exactly seed A's settled thumbnail.
  const initial = useMemo(
    () =>
      buildRingMorph(
        SETTLE_T,
        SETTLE_TWISTT,
        SETTLE_MORPH,
        hoverA,
        hoverB,
        0,
        segments,
        pieces,
        grayscale,
        white,
      ),
    [hoverA, hoverB, segments, pieces, grayscale, white],
  );
  const nStops = initial.strands[0].colors.length;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDoneRef.current?.(); // skip straight to the settled B thumbnail
      return;
    }
    let raf = 0;
    const start = performance.now();
    const render = (e: number) => {
      const fr = buildRingMorph(
        SETTLE_T,
        SETTLE_TWISTT,
        SETTLE_MORPH,
        hoverA,
        hoverB,
        e,
        segments,
        pieces,
        grayscale,
        white,
      );
      baseRef.current?.setAttribute("d", fr.d);
      for (let i = 0; i < fr.strands.length; i++) {
        const s = fr.strands[i];
        bodyRefs.current[i]?.setAttribute("d", s.d);
        const g = gradRefs.current[i];
        if (g) {
          g.setAttribute("x1", f2(s.x1));
          g.setAttribute("y1", f2(s.y1));
          g.setAttribute("x2", f2(s.x2));
          g.setAttribute("y2", f2(s.y2));
        }
        const stops = stopRefs.current[i];
        if (stops) {
          for (let j = 0; j < s.colors.length; j++) {
            const el = stops[j];
            if (el) {
              el.setAttribute("stop-color", s.colors[j]);
              el.setAttribute("stop-opacity", s.alphas[j].toFixed(3));
            }
          }
        }
      }
    };
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      // Run the FULL curve — backOut overshoots then resolves to exactly 1 at
      // p = 1, so the morph fully settles on seed B before we stop.
      render(backOut(p * p * (3 - 2 * p)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else onDoneRef.current?.();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hoverA, hoverB, durationMs, segments, pieces, grayscale, white]);

  const cap = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

  return (
    <svg
      width={size}
      height={(size * VIEW_H) / VIEW_W}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${uid}dk`}
          gradientUnits="userSpaceOnUse"
          x1={GRAD_X1}
          y1={CY}
          x2={GRAD_X2}
          y2={CY}
        >
          {white ? (
            <>
              <stop offset="0" stopColor="#fff" stopOpacity={WHITE_BASE_OPACITY[0]} />
              <stop offset="1" stopColor="#fff" stopOpacity={WHITE_BASE_OPACITY[1]} />
            </>
          ) : (
            <>
              <stop offset="0" stopColor={DARK_BASE[0]} />
              <stop offset="1" stopColor={DARK_BASE[1]} />
            </>
          )}
        </linearGradient>
        {initial.strands.map((s, i) => (
          <linearGradient
            key={i}
            id={`${uid}g${i}`}
            gradientUnits="userSpaceOnUse"
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            ref={(el) => {
              gradRefs.current[i] = el;
            }}
          >
            {Array.from({ length: nStops }).map((_, j) => (
              <stop
                key={j}
                offset={(j / (nStops - 1)).toFixed(4)}
                stopColor={s.colors[j]}
                stopOpacity={s.alphas[j]}
                ref={(el) => {
                  (stopRefs.current[i] ??= [])[j] = el;
                }}
              />
            ))}
          </linearGradient>
        ))}
      </defs>

      <path
        ref={baseRef}
        d={initial.d}
        fill="none"
        stroke={`url(#${uid}dk)`}
        strokeWidth={STROKE}
        {...cap}
      />
      <g fill="none" pointerEvents="none" {...cap}>
        {initial.strands.map((s, i) => (
          <path
            key={i}
            ref={(el) => {
              bodyRefs.current[i] = el;
            }}
            d={s.d}
            stroke={`url(#${uid}g${i})`}
            strokeWidth={STROKE}
          />
        ))}
      </g>
    </svg>
  );
}
