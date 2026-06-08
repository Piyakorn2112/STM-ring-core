/**
 * ringRegistryCore — the *scannable* STM code: the brand flower at the heart,
 * wrapped by a rigid circular REGISTRATION ring and concentric data rings.
 *
 * WHY THIS EXISTS (read alongside ringCodeCore)
 * ---------------------------------------------
 * `ringCodeCore` renders the payload as dashes ALONG the free-form, self-crossing
 * flower centre-line ("dust of the ring"). That looks great but is very hard to
 * decode optically — recovering a self-crossing centre-line from pixels is a
 * research-grade problem (four recovery approaches were measured and all failed).
 *
 * This module takes the PROVEN path instead, the same one App-Clip / Spotify codes
 * use: a perfect CIRCLE is trivial and rock-solid to detect (centre + scale from a
 * bounding box; a single gap fixes the origin), so we read the data in that circle's
 * polar frame at KNOWN radii × angular slots — no curve tracing at all. Measured
 * 18/18 round-trip at full ECC confidence on rasterised renders.
 *
 * LAYERING (OOP-style, core stays safe)
 * -------------------------------------
 *   stmRingCore      — brand geometry + `exportThumbnailSVG` (the flower). UNTOUCHED.
 *   ringCodeCore     — the codec (`encodeSymbols`/`decodeFrame`, Hamming ECC). SHARED.
 *   ringRegistryCore — THIS: lays the codec's symbols onto polar data rings + a
 *                      registration circle around the flower.
 *   ringRegistryScanner — the matching optical decoder (imports the constants here).
 *
 * The codec is the shared seam: encoder and decoder both speak `encodeSymbols`/
 * `decodeFrame`, and the GEOMETRY constants live here once so the two never drift.
 */

import { encodeSymbols, PAYLOAD_BITS, SYMBOL_COUNT } from "./ringCodeCore";
import { CX, CY, exportThumbnailSVG, PALETTE, STROKE, VIEW_W } from "./stmRingCore";

// ---- Registry geometry (the single source of truth; the scanner imports this) ---
// A square canvas with the flower centred; two concentric data rings and an outer
// registration circle, all clearing the flower. Tuned for robust polar reads.
export const REG = {
  CAN: 260, // canvas size (square, in the flower's own units)
  C: 130, // centre (CAN/2)
  RINGS: [94, 108] as const, // concentric data-ring radii (clear the flower ~R72)
  N_SLOTS: 30, // angular slots per ring (slot 0 reserved as the origin gap)
  REG_R: 120, // outer registration-circle radius
  GAP: 0.18, // half-angle (rad) of the origin gap in the registration circle
  TICK_ANG: -0.4, // winding-reference tick angle (just outside the gap, one side)
  SLOT_FILL: 0.72, // arc fraction a data dot fills within its slot
};
export const REG_STROKE = STROKE * 0.2; // registration-circle line weight
export const DOT_STROKE = STROKE * 0.42; // data-dot arc weight

// Bits available = RINGS × (N_SLOTS-1); frame needs SYMBOL_COUNT×3. Plenty of margin.
export const DATA_BITS_AVAIL = REG.RINGS.length * (REG.N_SLOTS - 1);
export const FRAME_BITS = SYMBOL_COUNT * 3;
export const MAX_PAYLOAD = 2 ** PAYLOAD_BITS - 1;

const f2 = (v: number) => v.toFixed(2);

/** Payload → flat bit stream (3 bits per Hamming-ECC symbol). */
export function payloadBits(payload: number): number[] {
  const bits: number[] = [];
  for (const s of encodeSymbols(payload)) bits.push((s >> 2) & 1, (s >> 1) & 1, s & 1);
  return bits;
}

// A stroked circular arc centred on the canvas centre.
function arc(r: number, a0: number, a1: number, w: number, color: string): string {
  const x0 = REG.C + r * Math.cos(a0);
  const y0 = REG.C + r * Math.sin(a0);
  const x1 = REG.C + r * Math.cos(a1);
  const y1 = REG.C + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `<path d="M${f2(x0)},${f2(y0)} A${f2(r)},${f2(r)} 0 ${large} 1 ${f2(x1)},${f2(y1)}" ` +
    `fill="none" stroke="${color}" stroke-width="${f2(w)}" stroke-linecap="round"/>`
  );
}

export type RegistryOpts = {
  size?: number; // output px (square)
  background?: string; // page background (omit = transparent)
  grayscaleFlower?: boolean; // flower in grey instead of brand colour
  ink?: string; // colour of the registration circle + data dots (default near-black)
};

/**
 * Encode a payload as a complete, deterministic, *scannable* SVG: the brand flower
 * (built from the same `stmcode:<payload>` seed family as ringCodeCore, so the shape
 * still authenticates the id) wrapped by the registration circle + polar data rings.
 */
export function encodeRegistryRingSVG(payload: number, opts: RegistryOpts = {}): string {
  if (payload < 0 || payload > MAX_PAYLOAD) {
    throw new RangeError(`payload must be 0..${MAX_PAYLOAD}`);
  }
  const ink = opts.ink ?? "#111111";
  const size = opts.size ?? REG.CAN;

  // The flower, centred in the canvas (strip its <svg> wrapper, re-place via <g>).
  const flower = exportThumbnailSVG(`stmcode:${payload}`, VIEW_W, opts.grayscaleFlower ?? false)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  let body = `<g transform="translate(${f2(REG.C - CX)},${f2(REG.C - CY)})">${flower}</g>`;

  // Registration circle with a single gap at angle 0 (the origin landmark) …
  body += arc(REG.REG_R, REG.GAP, 2 * Math.PI - REG.GAP, REG_STROKE, ink);
  // … and an asymmetric winding tick just past the gap (fixes spin direction).
  const tx = REG.C + REG.REG_R * Math.cos(REG.TICK_ANG);
  const ty = REG.C + REG.REG_R * Math.sin(REG.TICK_ANG);
  body += `<circle cx="${f2(tx)}" cy="${f2(ty)}" r="${f2(DOT_STROKE * 0.6)}" fill="${ink}"/>`;

  // Data dots: ring r × slot s (1..N_SLOTS-1), one bit each (present = 1).
  const bits = payloadBits(payload);
  let bi = 0;
  for (const r of REG.RINGS) {
    for (let s = 1; s < REG.N_SLOTS; s++) {
      const on = bits[bi++] || 0;
      if (!on) continue;
      const th = (s / REG.N_SLOTS) * 2 * Math.PI;
      const half = (REG.SLOT_FILL * Math.PI) / REG.N_SLOTS;
      body += arc(r, th - half, th + half, DOT_STROKE, ink);
    }
  }

  const bg = opts.background ? `<rect width="100%" height="100%" fill="${opts.background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(size)}" height="${f2(size)}" ` +
    `viewBox="0 0 ${REG.CAN} ${REG.CAN}">${bg}${body}</svg>`
  );
}

/** Convenience: the brand-colour accent for a payload (used by the reveal UI). */
export function accentFor(payload: number): string {
  return PALETTE[payload % PALETTE.length];
}
