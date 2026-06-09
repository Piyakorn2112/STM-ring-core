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

// (2) Registration. With no dedicated outer circle, the OUTERMOST data ring is the
// frame: a bounding box gives a rough centre, a radial histogram locates the outer
// ring (skipping the sparse rotation dot beyond it), and a Kåsa least-squares fit —
// with one outlier-rejection refit so the dot can't pull it — pins centre + radius.
export function fitCircle({ m, W, H }: Mask): Circle | null {
  // Collect ink points and a bbox-centre seed (robust to lopsided data; the dot only
  // nudges one axis a little).
  const px: number[] = [], py: number[] = [];
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      px.push(x); py.push(y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (px.length < 40) return null;
  const bbx = (minX + maxX) / 2, bby = (minY + maxY) / 2;
  let cmx = 0, cmy = 0;
  for (let i = 0; i < px.length; i++) { cmx += px[i]; cmy += py[i]; }
  cmx /= px.length; cmy /= px.length;
  const maxR = Math.max(maxX - minX, maxY - minY) / 2;
  const BIN = 2;
  const nb = Math.ceil((maxR * 1.15) / BIN) + 1;

  // Centre search: the true centre snaps the 4 concentric rings into sharp radial
  // peaks, so the radius histogram's "energy" (Σ count²) is maximised there. Search a
  // wide window around BOTH the bbox and centroid seeds (lopsided data biases each
  // differently), coarse then fine.
  const hist = new Int32Array(nb);
  const score = (cx: number, cy: number): number => {
    hist.fill(0);
    for (let i = 0; i < px.length; i++) {
      const r = Math.hypot(px[i] - cx, py[i] - cy);
      hist[Math.min(nb - 1, Math.floor(r / BIN))]++;
    }
    let s = 0;
    for (let b = 0; b < nb; b++) s += hist[b] * hist[b];
    return s;
  };
  let bestX = bbx, bestY = bby, bestS = -1;
  for (const [sx, sy] of [[bbx, bby], [cmx, cmy]]) {
    for (let dy = -20; dy <= 20; dy += 2) {
      for (let dx = -20; dx <= 20; dx += 2) {
        const s = score(sx + dx, sy + dy);
        if (s > bestS) { bestS = s; bestX = sx + dx; bestY = sy + dy; }
      }
    }
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const s = score(bestX + dx, bestY + dy);
      if (s > bestS) { bestS = s; bestX += dx; bestY += dy; }
    }
  }

  // Outer data ring = outermost substantial histogram peak (skips the sparse dot).
  score(bestX, bestY);
  let peak = 0;
  for (let b = 0; b < nb; b++) if (hist[b] > peak) peak = hist[b];
  let R = maxR;
  for (let b = nb - 1; b >= 0; b--) {
    if (hist[b] >= Math.max(12, peak * 0.35)) { R = (b + 0.5) * BIN; break; }
  }
  return { cx: bestX, cy: bestY, R };
}

// (3) Origin reference = the lone rotation dot, the only ink sitting OUTSIDE the outer
// data ring. Its angle, minus the known dot offset, gives the origin. Returns null if
// no dot is found (so the caller can bail rather than misread).
export function findOriginDot({ m, W, H }: Mask, { cx, cy, R }: Circle): number | null {
  // R is the outer-ring radius; the dot is at DOT_POS/REG_RING × R, comfortably beyond.
  const beyond = (R * 1.06) ** 2;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < beyond) continue;
      sx += x; sy += y; n++;
    }
  }
  if (n < 3) return null;
  const dotAngle = Math.atan2(sy / n - cy, sx / n - cx);
  return dotAngle - BLOOM.TICK_ANG; // origin = dot angle − dot's offset from origin
}

// (4) Sample the 4 data rings into a grid at the given origin. `R` is the fitted
// outer-ring radius, so the polar scale is R / REG_RING.
function readGrid(mask: Mask, circle: Circle, origin: number): number[][] {
  const { m, W, H } = mask;
  const { cx, cy, R } = circle;
  const scale = R / BLOOM.REG_RING;
  const grid: number[][] = Array.from({ length: LAYERS }, () => new Array(BLOOM.N_SLOTS).fill(0));
  for (let s = 1; s < BLOOM.N_SLOTS; s++) {
    const th = origin + (s / BLOOM.N_SLOTS) * 2 * Math.PI;
    for (let ring = 0; ring < LAYERS; ring++) {
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
  const dotOrigin = findOriginDot(mask, circle);
  if (dotOrigin === null) return { ok: false, eccOk: false, payload: -1, confidence: 0, circle, originAngle: 0 };
  // Without a solid registration circle the fitted centre/scale carry a little error,
  // so search a small origin × scale window and keep the most self-consistent decode
  // (verify-by-synthesis through the codec) — this absorbs the residual geometry error.
  let bestPay = -1, bestAgree = -1, bestOrigin = dotOrigin, bestRs = 1;
  for (const rs of [0.96, 0.98, 1.0, 1.02, 1.04]) {
    const c2 = { cx: circle.cx, cy: circle.cy, R: circle.R * rs };
    for (let off = -6; off <= 6; off++) {
      const origin = dotOrigin + off * 0.012;
      const { payload, symbols } = decodeGrid(readGrid(mask, c2, origin));
      if (payload < 0 || payload > 0xffff) continue;
      const re = encodeSymbolsRef(payload);
      let agree = 0;
      for (let i = 0; i < SYMBOL_COUNT; i++) if (re[i] === symbols[i]) agree++;
      if (agree > bestAgree) { bestAgree = agree; bestPay = payload; bestOrigin = origin; bestRs = rs; }
      if (agree === SYMBOL_COUNT) break;
    }
    if (bestAgree === SYMBOL_COUNT) break;
  }
  const confidence = bestAgree < 0 ? 0 : bestAgree / SYMBOL_COUNT;
  // Return the geometry that actually decoded best, so the centre-shape check samples
  // the same frame the data was read from.
  return {
    ok: false,
    eccOk: confidence >= 0.92,
    payload: bestPay,
    confidence,
    circle: { cx: circle.cx, cy: circle.cy, R: circle.R * bestRs },
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
  const scale = R / BLOOM.REG_RING; // px per canvas unit
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

// The centre shape check compares SILHOUETTES, so it must capture the whole wire —
// including bright charge areas a 150 threshold misses, and across renderers that draw
// the flower's gradients/blend differently. A lenient threshold (anything clearly
// darker than the white field) makes the captured + reference masks robustly agree.
export const CENTRE_INK_THRESH = 220;
// Acceptance threshold for the centre check. With the silhouette threshold, legitimate
// captures measured ≥0.82 and mismatched/forged centres ≤0.56, so 0.65 separates them
// with margin on both sides (and headroom for renderer/camera variance).
export const CENTRE_IOU_MIN = 0.65;

/** IoU between two equal-size binary patches (the centre shape check). */
export function centreIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) uni++;
    if (a[i] && b[i]) inter++;
  }
  return uni ? inter / uni : 0;
}
