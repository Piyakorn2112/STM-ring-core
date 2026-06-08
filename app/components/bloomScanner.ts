/**
 * bloomScanner — the optical decoder for `bloomCodeCore` Bloom Codes.
 *
 * A small modular pipeline of PURE functions. It leans entirely on the registration
 * circle: detect it (centre + scale from the bounding box; origin from the gap), then
 * read everything in its polar frame — no curve tracing, rotation safe.
 *
 *   ImageData ─▶ inkMask ─▶ fitCircle ─▶ findOriginGap ─▶ readGrid ─▶ decodeGrid(ECC)
 *                                                                          │
 *                                              centre verify (shape IoU) ◀─┘
 *
 * The centre check is the caller's last gate: regenerate the bloom for the decoded id
 * and compare to the captured centre via `centreIoU` (≥ ~0.55 ⇒ authentic).
 */

import { decodeFrame, SYMBOL_COUNT } from "./ringCodeCore";
import { BLOOM, frameBitAt, FRAME_BITS, LAYERS } from "./bloomCodeCore";

export type Mask = { m: Uint8Array; W: number; H: number };
export type Circle = { cx: number; cy: number; R: number };
export type BloomScan = {
  ok: boolean; // ECC decoded AND centre verified
  eccOk: boolean; // ECC frame consistent
  payload: number;
  confidence: number; // 0..1 ECC frame symbol agreement
  circle: Circle | null;
  originAngle: number;
};

// (1) RGBA → binary ink mask (dark = ink).
export function inkMask(data: Uint8ClampedArray | Uint8Array, W: number, H: number, thresh = 150): Mask {
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3];
    const lum = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    m[i] = a > 60 && lum < thresh ? 1 : 0;
  }
  return { m, W, H };
}

// (2) Registration circle. A bounding box gives a rough centre+radius; then a Kåsa
// least-squares fit on the points lying on the outer ring refines it — which stays
// accurate even when a big arc is occluded (the surviving 2/3 still constrains it),
// so the polar frame holds up under heavy obscuring.
export function fitCircle({ m, W, H }: Mask): Circle | null {
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let R = (maxX - minX + (maxY - minY)) / 4;

  // Kåsa fit on outer-ring points (radius within a tight band of the rough R, so the
  // inner data rings are excluded). Solve z = u·x + v·y + w, z = x²+y².
  let n = 0, Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  const lo = (0.955 * R) ** 2, hi = (1.05 * R) ** 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 < lo || d2 > hi) continue;
      const z = x * x + y * y;
      n++; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
      Sxz += x * z; Syz += y * z; Sz += z;
    }
  }
  if (n >= 16) {
    // 3×3 normal equations for [u, v, w]
    const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
    const B = [Sxz, Syz, Sz];
    const sol = solve3(A, B);
    if (sol) {
      const [u, v, w] = sol;
      const a = u / 2, b = v / 2;
      const rr = w + a * a + b * b;
      if (rr > 0) { cx = a; cy = b; R = Math.sqrt(rr); }
    }
  }
  return { cx, cy, R };
}

// Tiny 3×3 solver (Cramer's rule) for the circle-fit normal equations.
function solve3(A: number[][], B: number[]): [number, number, number] | null {
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-9) return null;
  const col = (i: number) => A.map((row, r) => row.map((v, c) => (c === i ? B[r] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

// (3) Origin = the inkless arc on the registration circle whose WIDTH matches the
// known origin gap (2·GAP). Picking by closest-width — not longest — keeps occlusion
// robust: a covered wedge makes a much WIDER gap and is ignored, so the origin stays
// locked even with a chunk of the code obscured.
export function findOriginGap({ m, W, H }: Mask, { cx, cy, R }: Circle): number {
  const NS = 1440;
  const pres = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const th = (i / NS) * 2 * Math.PI;
    for (let dr = -4; dr <= 4; dr++) {
      const r = R + dr;
      const x = Math.round(cx + r * Math.cos(th));
      const y = Math.round(cy + r * Math.sin(th));
      if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) { pres[i] = 1; break; }
    }
  }
  const expected = ((2 * BLOOM.GAP) / (2 * Math.PI)) * NS;
  let bestDiff = Infinity, bestStart = 0, bestLen = expected;
  for (let i = 0; i < NS * 2; ) {
    if (pres[i % NS]) { i++; continue; }
    let j = i;
    while (j < NS * 2 && !pres[j % NS]) j++;
    const len = j - i;
    if (len <= NS) {
      const diff = Math.abs(len - expected);
      if (diff < bestDiff) { bestDiff = diff; bestStart = i; bestLen = len; }
    }
    i = j;
  }
  return (((bestStart + bestLen / 2) % NS) / NS) * 2 * Math.PI;
}

// Is the registration circle present at absolute angle `th`? An angle where it is
// MISSING (other than the small origin gap) means that sector is occluded/cropped —
// the obscure-safe signal: such slots are read as "unknown", not as confident 0.
function regPresent({ m, W, H }: Mask, { cx, cy, R }: Circle, th: number): boolean {
  for (let dr = -5; dr <= 5; dr++) {
    const r = R + dr;
    const x = Math.round(cx + r * Math.cos(th));
    const y = Math.round(cy + r * Math.sin(th));
    if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) return true;
  }
  return false;
}

// (4) Sample the 4 data rings into a grid at the given origin. A slot whose sector is
// occluded (registration circle absent there) is marked -1 (unknown).
function readGrid(mask: Mask, circle: Circle, origin: number): number[][] {
  const { m, W, H } = mask;
  const { cx, cy, R } = circle;
  const scale = R / BLOOM.REG_R;
  const grid: number[][] = Array.from({ length: LAYERS }, () => new Array(BLOOM.N_SLOTS).fill(0));
  for (let s = 1; s < BLOOM.N_SLOTS; s++) {
    const th = origin + (s / BLOOM.N_SLOTS) * 2 * Math.PI;
    const occluded = !regPresent(mask, circle, th);
    for (let ring = 0; ring < LAYERS; ring++) {
      if (occluded) { grid[ring][s] = -1; continue; }
      const rPix = BLOOM.RINGS[ring] * scale;
      let hit = 0, c = 0;
      for (let da = -0.3; da <= 0.3; da += 0.15) {
        for (let dr = -3; dr <= 3; dr++) {
          const r = rPix + dr;
          const ang = th + (da * Math.PI) / BLOOM.N_SLOTS;
          const x = Math.round(cx + r * Math.cos(ang));
          const y = Math.round(cy + r * Math.sin(ang));
          if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) hit++;
          c++;
        }
      }
      grid[ring][s] = hit / c > 0.3 ? 1 : 0;
    }
  }
  return grid;
}

// (5) Majority-vote each frame bit over its interleaved copies, then ECC decode.
function decodeGrid(grid: number[][]): { payload: number; symbols: number[] } {
  const votes: [number, number][] = Array.from({ length: FRAME_BITS }, () => [0, 0]);
  for (let ring = 0; ring < LAYERS; ring++) {
    for (let slot = 1; slot < BLOOM.N_SLOTS; slot++) {
      const v = grid[ring][slot];
      if (v < 0) continue; // unknown (occluded) — skip, let the spread-out copies decide
      votes[frameBitAt(ring, slot)][v]++;
    }
  }
  const fb = votes.map(([z, on]) => (on > z ? 1 : 0));
  const symbols: number[] = [];
  for (let i = 0; i + 2 < fb.length; i += 3) symbols.push((fb[i] << 2) | (fb[i + 1] << 1) | fb[i + 2]);
  return { payload: decodeFrame(symbols).payload, symbols };
}

/**
 * Decode the data field: ImageData → payload + ECC confidence. Searches a few sub-slot
 * origin offsets and keeps the most self-consistent (verify-by-synthesis through the
 * codec). Does NOT do the centre check — the caller gates on `centreIoU` after.
 */
export function decodeBloomData(
  data: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  encodeSymbolsRef: (payload: number) => number[],
): BloomScan {
  const mask = inkMask(data, W, H);
  const circle = fitCircle(mask);
  if (!circle || circle.R < 10) return { ok: false, eccOk: false, payload: -1, confidence: 0, circle: null, originAngle: 0 };
  const gap = findOriginGap(mask, circle);
  let bestPay = -1, bestAgree = -1, bestOrigin = gap;
  for (let off = -3; off <= 3; off++) {
    const origin = gap + off * 0.01;
    const { payload, symbols } = decodeGrid(readGrid(mask, circle, origin));
    if (payload < 0 || payload > 0xffff) continue;
    const re = encodeSymbolsRef(payload);
    let agree = 0;
    for (let i = 0; i < SYMBOL_COUNT; i++) if (re[i] === symbols[i]) agree++;
    if (agree > bestAgree) { bestAgree = agree; bestPay = payload; bestOrigin = origin; }
  }
  const confidence = bestAgree < 0 ? 0 : bestAgree / SYMBOL_COUNT;
  return {
    ok: false,
    eccOk: confidence >= 0.92,
    payload: bestPay,
    confidence,
    circle,
    originAngle: bestOrigin,
  };
}

/**
 * Resample the captured centre into a canonical SZ×SZ binary patch: de-rotated by the
 * origin angle and scaled by the registration radius, covering radius ±CENTRE_R. The
 * caller compares this to `bloomCentreSVG(payload)` rendered at the same SZ.
 */
export function extractCentre(mask: Mask, circle: Circle, origin: number, SZ: number): Uint8Array {
  const { m, W, H } = mask;
  const { cx, cy, R } = circle;
  const scale = R / BLOOM.REG_R; // px per canvas unit
  const out = new Uint8Array(SZ * SZ);
  const cos = Math.cos(origin), sin = Math.sin(origin);
  for (let v = 0; v < SZ; v++) {
    for (let u = 0; u < SZ; u++) {
      // patch coords → canvas-unit offset in [-CENTRE_R, CENTRE_R]
      const ox = ((u + 0.5) / SZ - 0.5) * 2 * BLOOM.CENTRE_R;
      const oy = ((v + 0.5) / SZ - 0.5) * 2 * BLOOM.CENTRE_R;
      // rotate by +origin (undo the capture's rotation) and scale to pixels
      const rx = (ox * cos - oy * sin) * scale;
      const ry = (ox * sin + oy * cos) * scale;
      const x = Math.round(cx + rx);
      const y = Math.round(cy + ry);
      out[v * SZ + u] = x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] ? 1 : 0;
    }
  }
  return out;
}

// Recommended acceptance threshold for the centre shape check: legitimate captures
// measured ≥0.52, mismatched/forged centres ≤0.37, so 0.45 separates with margin.
export const CENTRE_IOU_MIN = 0.45;

/** IoU between two equal-size binary patches (the centre shape check). */
export function centreIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) uni++;
    if (a[i] && b[i]) inter++;
  }
  return uni ? inter / uni : 0;
}
