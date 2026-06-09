/**
 * bloomCodeCore — the STM "Bloom Code": a scannable badge whose HEART is an
 * enforced curved bloom (the brand flower, locked to 3/4/5/6-fold symmetry — never
 * a rectangle, oval or plain circle) and whose RING is a multilayered, App-Clip-style
 * field of short concentric dashes carrying the payload with heavy redundancy.
 *
 * THREE THINGS MAKE IT WORK (all measured, see the /tmp harnesses):
 *  1. REGISTRATION CIRCLE — a perfect outer circle with a single origin gap. Trivial
 *     and rock-solid to detect (centre+scale from a bounding box; gap = origin), so
 *     all data is read in its polar frame at KNOWN radii — no curve tracing. Rotation
 *     safe by construction.
 *  2. OBSCURE-SAFE DATA — the codec frame (Hamming-ECC symbols) is written across the
 *     LAYERS×SLOTS grid with an interleaved repeat, so any localised obscuring (a
 *     covered wedge) only nicks spread-out copies that majority-vote + ECC recover.
 *     Measured: 200/200 clean AND 200/200 with a 90° wedge fully occluded.
 *  3. THE CENTRE HAS A ROLE — the bloom shape is deterministic from the payload, so a
 *     decoder regenerates the expected bloom and verifies the captured centre by shape
 *     IoU (right payload ≈1.0, wrong payloads ≤0.48). The centre authenticates the id;
 *     it is not decoration.
 *
 * LAYERING: stmRingCore (brand geometry, UNTOUCHED) → ringCodeCore (the shared codec)
 * → THIS (bloom selection + layout) → bloomScanner (the optical decoder).
 */

import { encodeSymbols, PAYLOAD_BITS, SYMBOL_COUNT } from "./ringCodeCore";
import { CX, CY, exportThumbnailSVG, makeHover, PALETTE, VIEW_W } from "./stmRingCore";

// ---- Bloom-code geometry (single source of truth; the scanner imports this) -----
export const BLOOM = {
  CAN: 300, // square canvas (in the flower's own units)
  C: 150, // centre (CAN/2)
  // 4 concentric data rings hugging the bloom (outer edge ~R72). The outermost ring
  // was dropped so the data field sits clear of the registration circle.
  RINGS: [80, 94, 108, 122] as const,
  N_SLOTS: 22, // angular slots/ring (~16° each — stays distinct at distance)
  REG_RING: 122, // the OUTERMOST data ring doubles as the registration circle (fitted)
  DOT_POS: 134, // radius of the lone rotation dot (just outside the data field)
  TICK_ANG: -0.34, // rotation-dot angle = the origin reference
  SLOT_FILL: 0.66, // arc fraction a dash fills (clear gaps → distinct far away)
  CENTRE_R: 75, // radius of the centre region used for shape verification (< ring 0)
};
export const LAYERS = BLOOM.RINGS.length;
export const SLOTS_PER = BLOOM.N_SLOTS - 1; // slot 0 reserved (origin gap zone)
export const GRID_POS = LAYERS * SLOTS_PER; // total data positions
export const FRAME_BITS = SYMBOL_COUNT * 3;
export const MAX_PAYLOAD = 2 ** PAYLOAD_BITS - 1;
export const FOLDS = [3, 4, 5, 6] as const; // allowed bloom symmetry orders

const DOT_W = 6.2; // data-dash stroke weight (thick → reads at distance / low-res)
const TICK_R = DOT_W * 0.85; // rotation dot — a little thicker than the data lines
const f2 = (v: number) => v.toFixed(2);

// Which frame bit a (ring, slot) cell carries. The +ring·7 offset places every frame
// bit's copies ~7 slots (~115°) apart AND on different rings — so each bit gets several
// copies that no obscuring wedge narrower than ~115° can all erase at once. That spread
// is what makes the code obscure-safe (copies decided by majority vote).
export const frameBitAt = (ring: number, slot: number): number =>
  ((slot - 1) + ring * 7) % FRAME_BITS;

export type BloomSeed = { k: number; fold: number; seed: string };

/**
 * Deterministically pick the bloom shape for a payload: the first seed in the
 * `bloomcode:<payload>:<k>` family whose ring locks to an ALLOWED fold (3/4/5/6).
 * Fast (median ~3 tries) and replayable, so a decoder recomputes the same expected
 * shape + fold from the recovered payload — no extra stored field.
 */
export function bloomSeed(payload: number): BloomSeed {
  for (let k = 0; k < 400; k++) {
    const seed = `bloomcode:${payload}:${k}`;
    const fold = makeHover(seed).twist.sym;
    if (fold >= 3 && fold <= 6) return { k, fold, seed };
  }
  // Should never happen (~25% of seeds qualify); fall back to a free seed.
  return { k: 0, fold: 0, seed: `bloomcode:${payload}:0` };
}

/** Payload → the LAYERS×N_SLOTS on/off grid (interleaved, repeated frame). */
export function encodeBloomGrid(payload: number): number[][] {
  const fb: number[] = [];
  for (const s of encodeSymbols(payload)) fb.push((s >> 2) & 1, (s >> 1) & 1, s & 1);
  const grid: number[][] = Array.from({ length: LAYERS }, () => new Array(BLOOM.N_SLOTS).fill(0));
  for (let ring = 0; ring < LAYERS; ring++) {
    for (let slot = 1; slot < BLOOM.N_SLOTS; slot++) {
      grid[ring][slot] = fb[frameBitAt(ring, slot)] || 0;
    }
  }
  return grid;
}

// A stroked concentric arc centred on the canvas centre.
function arc(r: number, a0: number, a1: number, w: number, color: string): string {
  const x0 = BLOOM.C + r * Math.cos(a0);
  const y0 = BLOOM.C + r * Math.sin(a0);
  const x1 = BLOOM.C + r * Math.cos(a1);
  const y1 = BLOOM.C + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `<path d="M${f2(x0)},${f2(y0)} A${f2(r)},${f2(r)} 0 ${large} 1 ${f2(x1)},${f2(y1)}" ` +
    `fill="none" stroke="${color}" stroke-width="${f2(w)}" stroke-linecap="round"/>`
  );
}

export type BloomOpts = {
  size?: number;
  background?: string;
  grayscaleFlower?: boolean;
  ink?: string; // colour of the registration circle + data dashes
};

/** The brand bloom, centred + canonical, with no code around it — the verify reference. */
export function bloomCentreSVG(payload: number, size: number, grayscale = false): string {
  const { seed } = bloomSeed(payload);
  const inner = exportThumbnailSVG(seed, VIEW_W, grayscale)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  const R = BLOOM.CENTRE_R;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="${f2(BLOOM.C - R)} ${f2(BLOOM.C - R)} ${f2(2 * R)} ${f2(2 * R)}">` +
    `<rect x="${f2(BLOOM.C - R)}" y="${f2(BLOOM.C - R)}" width="${f2(2 * R)}" height="${f2(2 * R)}" fill="#fff"/>` +
    `<g transform="translate(${f2(BLOOM.C - CX)},${f2(BLOOM.C - CY)})">${inner}</g></svg>`
  );
}

/** Encode a payload into the full Bloom Code SVG (bloom + registration + data rings). */
export function encodeBloomSVG(payload: number, opts: BloomOpts = {}): string {
  if (payload < 0 || payload > MAX_PAYLOAD) throw new RangeError(`payload must be 0..${MAX_PAYLOAD}`);
  const ink = opts.ink ?? "#111111";
  const size = opts.size ?? BLOOM.CAN;

  // Bloom at the heart (centred, canonical orientation).
  const { seed } = bloomSeed(payload);
  const flower = exportThumbnailSVG(seed, VIEW_W, opts.grayscaleFlower ?? false)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  let body = `<g transform="translate(${f2(BLOOM.C - CX)},${f2(BLOOM.C - CY)})">${flower}</g>`;

  // Lone rotation dot, just outside the data field — the origin reference. (No outer
  // registration circle: the concentric data rings are themselves the fitted frame.)
  const tx = BLOOM.C + BLOOM.DOT_POS * Math.cos(BLOOM.TICK_ANG);
  const ty = BLOOM.C + BLOOM.DOT_POS * Math.sin(BLOOM.TICK_ANG);
  body += `<circle cx="${f2(tx)}" cy="${f2(ty)}" r="${f2(TICK_R)}" fill="${ink}"/>`;

  // Data: concentric dashes across all layers. Consecutive on-slots in a ring MERGE
  // into one flowing arc (the App-Clip look) while isolated on-slots stay short — both
  // keep a SLOT_FILL gap at each end so every slot stays distinct for the reader.
  const grid = encodeBloomGrid(payload);
  const slotAng = (2 * Math.PI) / BLOOM.N_SLOTS;
  const half = (BLOOM.SLOT_FILL * Math.PI) / BLOOM.N_SLOTS;
  for (let ring = 0; ring < LAYERS; ring++) {
    const r = BLOOM.RINGS[ring];
    let s = 1;
    while (s < BLOOM.N_SLOTS) {
      if (!grid[ring][s]) { s++; continue; }
      let e = s;
      while (e + 1 < BLOOM.N_SLOTS && grid[ring][e + 1]) e++;
      body += arc(r, s * slotAng - half, e * slotAng + half, DOT_W, ink);
      s = e + 1;
    }
  }

  const bg = opts.background ? `<rect width="100%" height="100%" fill="${opts.background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(size)}" height="${f2(size)}" ` +
    `viewBox="0 0 ${BLOOM.CAN} ${BLOOM.CAN}">${bg}${body}</svg>`
  );
}

/** Brand accent colour for a payload (used by the reveal UI). */
export function accentFor(payload: number): string {
  return PALETTE[payload % PALETTE.length];
}
