/**
 * ringRegistryScanner — the optical decoder for `ringRegistryCore` codes.
 *
 * A small, modular pipeline of PURE functions (each independently testable), kept
 * deliberately separate from the encoder so either can be swapped:
 *
 *   ImageData ──▶ inkMask ──▶ fitCircle ──▶ findOriginGap ──▶ readPolarBits ──▶ decodeFrame
 *                  (1)          (2)             (3)                (4)              (codec)
 *
 * The whole thing leans on ONE robust fact: the registration circle is a perfect
 * circle, so (2) centre+scale and (3) origin are trivial and stable. Everything
 * downstream samples in that polar frame at KNOWN radii — no curve tracing.
 *
 * It imports the geometry constants from `ringRegistryCore` (so encoder/decoder can
 * never drift) and the codec from `ringCodeCore` (the shared seam).
 */

import { decodeFrame, SYMBOL_COUNT } from "./ringCodeCore";
import { REG } from "./ringRegistryCore";

export type Mask = { m: Uint8Array; W: number; H: number };
export type Circle = { cx: number; cy: number; R: number };
export type ScanResult = {
  ok: boolean;
  payload: number;
  confidence: number; // 0..1 — fraction of frame symbols that re-encode consistently
  circle: Circle | null; // detected registration circle (for the reveal overlay)
  originAngle: number; // detected origin-gap angle (rad)
};

// (1) Threshold an RGBA ImageData buffer to a binary ink mask (dark = ink).
export function inkMask(data: Uint8ClampedArray | Uint8Array, W: number, H: number, thresh = 150): Mask {
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    m[i] = a > 60 && (r + g + b) / 3 < thresh ? 1 : 0;
  }
  return { m, W, H };
}

// (2) Fit the registration circle. It is the dominant outermost ink, so its bounding
// box gives centre + radius directly — robust and parameter-free.
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
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, R: ((maxX - minX) + (maxY - minY)) / 4 };
}

// (3) Find the origin gap: the longest inkless angular run on the registration circle.
export function findOriginGap({ m, W, H }: Mask, { cx, cy, R }: Circle): number {
  const NS = 1440;
  const pres = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const th = (i / NS) * 2 * Math.PI;
    for (let dr = -4; dr <= 4; dr++) {
      const r = R + dr;
      const x = Math.round(cx + r * Math.cos(th));
      const y = Math.round(cy + r * Math.sin(th));
      if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) {
        pres[i] = 1;
        break;
      }
    }
  }
  // longest run of 0 with wrap-around
  let bestLen = 0, bestStart = 0;
  for (let i = 0; i < NS * 2; ) {
    if (pres[i % NS]) { i++; continue; }
    let j = i;
    while (j < NS * 2 && !pres[j % NS]) j++;
    if (j - i > bestLen) { bestLen = j - i; bestStart = i; }
    i = j;
  }
  return (((bestStart + bestLen / 2) % NS) / NS) * 2 * Math.PI;
}

// (4) Read the polar data rings into a bit stream, given an origin angle.
export function readPolarBits(mask: Mask, circle: Circle, origin: number): number[] {
  const { m, W, H } = mask;
  const { cx, cy, R } = circle;
  const scale = R / REG.REG_R;
  const bits: number[] = [];
  for (const ringR of REG.RINGS) {
    const rPix = ringR * scale;
    for (let s = 1; s < REG.N_SLOTS; s++) {
      const th = origin + (s / REG.N_SLOTS) * 2 * Math.PI;
      let hit = 0, c = 0;
      for (let da = -0.3; da <= 0.3; da += 0.15) {
        for (let dr = -3; dr <= 3; dr++) {
          const r = rPix + dr;
          const ang = th + (da * Math.PI) / REG.N_SLOTS;
          const x = Math.round(cx + r * Math.cos(ang));
          const y = Math.round(cy + r * Math.sin(ang));
          if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) hit++;
          c++;
        }
      }
      bits.push(hit / c > 0.3 ? 1 : 0);
    }
  }
  return bits;
}

const bitsToSymbols = (bits: number[]): number[] => {
  const syms: number[] = [];
  for (let i = 0; i + 2 < bits.length; i += 3) syms.push((bits[i] << 2) | (bits[i + 1] << 1) | bits[i + 2]);
  return syms;
};

/**
 * Full decode: ImageData → payload. Searches a few sub-slot origin offsets around the
 * detected gap and keeps the candidate whose decode re-encodes most consistently
 * (verify-by-synthesis through the codec) — this absorbs small alignment error.
 *
 * `encodeSymbolsRef` is injected so the scanner stays decoupled from the encoder file
 * (callers pass `encodeSymbols` from ringCodeCore). Confidence = agreeing frame
 * symbols / SYMBOL_COUNT.
 */
export function decodeRegistryImage(
  data: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  encodeSymbolsRef: (payload: number) => number[],
): ScanResult {
  const mask = inkMask(data, W, H);
  const circle = fitCircle(mask);
  if (!circle || circle.R < 8) {
    return { ok: false, payload: -1, confidence: 0, circle: null, originAngle: 0 };
  }
  const gap = findOriginGap(mask, circle);
  let bestPay = -1, bestAgree = -1, bestOrigin = gap;
  for (let off = -3; off <= 3; off++) {
    const origin = gap + off * 0.012;
    const syms = bitsToSymbols(readPolarBits(mask, circle, origin));
    const { payload } = decodeFrame(syms);
    if (payload < 0 || payload > 0xffff) continue;
    const re = encodeSymbolsRef(payload);
    let agree = 0;
    for (let i = 0; i < SYMBOL_COUNT; i++) if (re[i] === syms[i]) agree++;
    if (agree > bestAgree) {
      bestAgree = agree;
      bestPay = payload;
      bestOrigin = origin;
    }
  }
  const confidence = bestAgree < 0 ? 0 : bestAgree / SYMBOL_COUNT;
  return {
    ok: confidence >= 0.92, // ≥11/12 frame symbols consistent
    payload: bestPay,
    confidence,
    circle,
    originAngle: bestOrigin,
  };
}
