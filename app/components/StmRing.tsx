"use client";

/**
 * StmRing — React shell over ./stmRingCore.
 *   • The whole wire is stroked ONCE with the smooth dark "default" gradient.
 *   • The charge is K ordered "strand" pieces laid over it, each with a dense
 *     per-vertex lit-colour gradient. Stop opacity carries the original smooth
 *     fade again, while lower-opacity edge stops get a small chroma lift so
 *     the fade keeps more energy; painting the strands in order gives real
 *     over/under depth at the crossings.
 *     Per frame we rewrite paths, gradient axes and every stop's colour + mask.
 *     Honours prefers-reduced-motion.
 *
 * Props: `forceSeed` locks the wire into a seed's twist (stuck hovered);
 * `grayscale` swaps the charge for grey.
 */

import { useEffect, useId, useRef } from "react";
import {
  VIEW_W,
  VIEW_H,
  CX,
  CY,
  R_MID,
  STROKE,
  GRAD_X1,
  GRAD_X2,
  DARK_BASE,
  WHITE_BASE_OPACITY,
  N_LIVE,
  K_LIVE,
  buildRing,
  buildRingMorph,
  makeHover,
  REST_HOVER,
  randomSeed,
  type Hover,
} from "./stmRingCore";

const HIT_STROKE = STROKE + 16;
const f2 = (v: number) => v.toFixed(2);
// Animate mode: each seed cycle lasts ANIM_PERIOD seconds. The wire rests on a
// seed for the first ANIM_HOLD fraction, then snaps to the next over the short
// remaining window with a bouncy overshoot.
const ANIM_PERIOD = 2.6;
const ANIM_HOLD = 0.66;
// Seconds to glide from one forced seed to the next (smooth shape swap).
const ONESHOT_DUR = 1.6;
// easeOutBack — overshoots past 1 then settles, giving the morph a gentle,
// natural bounce. Low c1 keeps the overshoot subtle.
const backOut = (t: number) => {
  const c1 = 0.6;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

export default function StmRing({
  size = 360,
  className,
  forceSeed = null,
  grayscale = false,
  animate = false,
  animateColor = false,
  white = false,
  segments = N_LIVE,
  pieces = K_LIVE,
  fps = 0,
}: {
  size?: number;
  className?: string;
  forceSeed?: string | null;
  grayscale?: boolean;
  animate?: boolean;
  /** Animate the charge colour flowing while the wire stays at its rest
   *  (untwisted) shape — the usual hover colour flow, minus the twist. */
  animateColor?: boolean;
  white?: boolean;
  /** Centre-line samples / strand count. Lower = cheaper (for big decorative
   *  rings where detail is invisible). Defaults match the core ring exactly. */
  segments?: number;
  pieces?: number;
  /** Cap the animation frame rate (0 = uncapped). Use for ambient rings. */
  fps?: number;
}) {
  const baseRef = useRef<SVGPathElement>(null);
  const bodyRefs = useRef<(SVGPathElement | null)[]>([]);
  const gradRefs = useRef<(SVGLinearGradientElement | null)[]>([]);
  const stopRefs = useRef<(SVGStopElement | null)[][]>([]);
  const morphRef = useRef(0);
  const targetRef = useRef(0);
  const hoverRef = useRef<Hover>(REST_HOVER);
  const twistT = useRef(0);
  const forcedRef = useRef(false);
  const grayRef = useRef(grayscale);
  const whiteRef = useRef(white);
  const segRef = useRef(segments);
  const pieceRef = useRef(pieces);
  const fpsRef = useRef(fps);
  // Animate mode: continuously morph between two random seeds (A → B). `blend`
  // ramps 0→1; on arrival B becomes A and a fresh random seed becomes B.
  const animRef = useRef(animate);
  const hoverBRef = useRef<Hover>(makeHover(randomSeed()));
  const blendRef = useRef(0);
  // Animate-colour mode: hold the rest (untwisted) shape, but ramp the charge in
  // and drift it — driven by a separate `chargeMorph` so geometry stays at rest.
  const animColorRef = useRef(animateColor);
  const colorMorphRef = useRef(0);
  // One-shot morph between two forced seeds (smooth swap when forceSeed changes).
  const oneShotRef = useRef(false);
  const uid = useId().replace(/:/g, "");

  const initial = buildRing(0, 0, 0, REST_HOVER, segments, pieces, grayscale, white);
  const nStops = initial.strands[0].colors.length;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    let last = start;
    let lastRender = start;
    const TAU = 0.22;
    const tick = (now: number) => {
      // Optional frame-rate cap for big ambient rings (skip without re-rendering).
      const frameInterval = fpsRef.current > 0 ? 1000 / fpsRef.current : 0;
      if (frameInterval && now - lastRender < frameInterval) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastRender = now;
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Animate mode keeps the wire fully formed and cycles seeds itself.
      if (animRef.current) targetRef.current = 1;
      // Animate-colour mode holds the GEOMETRY at its rest (untwisted) shape.
      else if (animColorRef.current) targetRef.current = 0;
      const dist = targetRef.current - morphRef.current;
      if (Math.abs(dist) < 0.0008) morphRef.current = targetRef.current;
      else morphRef.current += dist * (1 - Math.exp(-dt / TAU));
      const m = morphRef.current;
      // Charge intensity normally tracks the geometry morph; in animate-colour
      // mode it ramps in and drifts on its own while the wire stays at rest.
      let chargeMorph = m;
      if (animColorRef.current && !animRef.current) {
        colorMorphRef.current += (1 - colorMorphRef.current) * (1 - Math.exp(-dt / TAU));
        chargeMorph = colorMorphRef.current;
        twistT.current += dt; // drift the colour even though the wire is at rest
      } else {
        twistT.current += m * dt;
      }

      let fr;
      if (animRef.current) {
        blendRef.current += dt / ANIM_PERIOD; // raw cycle phase 0..1
        if (blendRef.current >= 1) {
          // Arrived at B: it becomes the new A, pick a fresh B, restart.
          blendRef.current -= 1;
          hoverRef.current = hoverBRef.current;
          hoverBRef.current = makeHover(randomSeed());
        }
        // Rest on the seed for ANIM_HOLD, then ease across in the rest of it.
        // smoothstep eases gently out of the pause; backOut adds a soft bounce.
        const p = blendRef.current;
        const tp = p <= ANIM_HOLD ? 0 : (p - ANIM_HOLD) / (1 - ANIM_HOLD);
        const eased = backOut(tp * tp * (3 - 2 * tp));
        fr = buildRingMorph(
          t,
          twistT.current,
          m,
          hoverRef.current,
          hoverBRef.current,
          eased,
          segRef.current,
          pieceRef.current,
          grayRef.current,
          whiteRef.current,
        );
      } else if (oneShotRef.current) {
        // Gliding from the current shape (A) to a newly forced seed (B).
        blendRef.current += dt / ONESHOT_DUR;
        const done = blendRef.current >= 1;
        const b = done ? 1 : blendRef.current;
        fr = buildRingMorph(
          t,
          twistT.current,
          m,
          hoverRef.current,
          hoverBRef.current,
          b * b * (3 - 2 * b), // smoothstep — graceful, no overshoot
          segRef.current,
          pieceRef.current,
          grayRef.current,
          whiteRef.current,
        );
        if (done) {
          hoverRef.current = hoverBRef.current;
          oneShotRef.current = false;
        }
      } else {
        fr = buildRing(
          t,
          twistT.current,
          m,
          hoverRef.current,
          segRef.current,
          pieceRef.current,
          grayRef.current,
          whiteRef.current,
          undefined,
          chargeMorph,
        );
      }
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
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const seed = forceSeed?.trim();
    const wasForced = forcedRef.current;
    forcedRef.current = !!seed;
    if (animRef.current) return; // animate mode owns the shape; don't override
    if (seed) {
      const next = makeHover(seed);
      if (wasForced && morphRef.current > 0.5) {
        // already settled on a shape → glide to the new one
        hoverBRef.current = next;
        blendRef.current = 0;
        oneShotRef.current = true;
      } else {
        // bloom out of rest
        hoverRef.current = next;
        oneShotRef.current = false;
      }
      targetRef.current = 1;
    } else {
      oneShotRef.current = false;
      targetRef.current = 0;
    }
  }, [forceSeed]);

  useEffect(() => {
    grayRef.current = grayscale;
  }, [grayscale]);

  useEffect(() => {
    whiteRef.current = white;
  }, [white]);

  useEffect(() => {
    segRef.current = segments;
    pieceRef.current = pieces;
    fpsRef.current = fps;
  }, [segments, pieces, fps]);

  useEffect(() => {
    animRef.current = animate;
    if (animate) {
      // Begin the cycle from a fresh pair of seeds.
      hoverRef.current = makeHover(randomSeed());
      hoverBRef.current = makeHover(randomSeed());
      blendRef.current = 0;
      targetRef.current = 1;
    } else {
      // Settle on whatever seed (or rest) the other props dictate.
      const seed = forceSeed?.trim();
      hoverRef.current = seed ? makeHover(seed) : REST_HOVER;
      targetRef.current = seed ? 1 : 0;
    }
  }, [animate, forceSeed]);

  useEffect(() => {
    animColorRef.current = animateColor;
    if (animateColor) {
      colorMorphRef.current = 0; // fade the charge in from rest
    } else if (!animRef.current) {
      // back to normal: settle on whatever forceSeed dictates (charge follows m)
      const seed = forceSeed?.trim();
      hoverRef.current = seed ? makeHover(seed) : REST_HOVER;
      targetRef.current = seed ? 1 : 0;
    }
  }, [animateColor, forceSeed]);

  const onEnter = () => {
    if (forcedRef.current || animRef.current || animColorRef.current) return;
    if (morphRef.current < 0.12) hoverRef.current = makeHover(randomSeed());
    targetRef.current = 1;
  };
  const onLeave = () => {
    if (!forcedRef.current && !animRef.current) targetRef.current = 0;
  };

  const cap = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

  return (
    <svg
      className={className}
      width={size}
      height={(size * VIEW_H) / VIEW_W}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Srang Tech Mai ring"
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

      {/* the whole wire in the smooth dark "default" gradient */}
      <path
        ref={baseRef}
        d={initial.d}
        fill="none"
        stroke={`url(#${uid}dk)`}
        strokeWidth={STROKE}
        {...cap}
      />
      {/* ordered charge strands — later ones pass over earlier ⇒ over/under */}
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

      {/* stable, invisible hover target shaped like the resting ring band */}
      <circle
        cx={CX}
        cy={CY}
        r={R_MID}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_STROKE}
        pointerEvents="stroke"
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      />
    </svg>
  );
}
