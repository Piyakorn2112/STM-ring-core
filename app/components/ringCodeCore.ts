/**
 * ringCodeCore — the STM "ring-code" generator. A sibling/child of stmRingCore.
 *
 * RELATIONSHIP TO THE CORE (read this first)
 * ------------------------------------------
 * This module EXTENDS the ring without touching it, OOP-style: the core is the
 * stable base, this is a child built on one shared seam. It imports exactly one
 * piece of load-bearing geometry — `centreLine` — plus the canonical settled
 * pose and a few constants. Everything code-specific (self-crossing detection,
 * the codec, slot layout, dash rendering) lives HERE, so the core stays small,
 * safe, and the single source of truth for the brand geometry. If the brand
 * curve ever changes, it changes in ONE place and this module follows for free.
 *
 * WHAT IT DOES
 * ------------
 * Renders the ring as discrete dashes curved along its own arc — the "dust of
 * the ring" look — that encode a small integer payload (a backend pointer / id).
 * A unique orange "comet" fiducial fixes the origin + winding direction, so the
 * code is decodable at any rotation (mirror-safety intentionally not required).
 *
 * DECODE NOTE: the symbol-level codec here (`buildCodeFrame` / `decodeFrame`) is
 * the full encode↔decode pair and is unit-testable today. The OPTICAL decoder
 * (camera image → symbols) is a separate future module; it re-uses the same
 * crossing/slot logic exported here to index slots identically.
 */

import {
  centreLine,
  type Hover,
  makeHover,
  sampleRingColors,
  SETTLE_POSE,
  STROKE,
  VIEW_H,
  VIEW_W,
} from "./stmRingCore";

// ---- Codec tunables -----------------------------------------------------
export const N_SLOTS = 32; // arc-length cells (data resolution) around the loop
const N_POINTS = 1200; // centre-line samples (smooth dashes; ~37 per slot)
const BITS_PER_SLOT = 3; // symbol 0..7 → one of 8 lane patterns (more variation)
const VERSION_BITS = 2; // reserved (v1 = 0); room for "signed code" variants
export const PAYLOAD_BITS = 16; // 65,536 distinct ids (backend resolves & namespaces)
const VERSION = 0;

const FIDUCIAL_SLOT = 0; // a distinct solid rung — fixes origin + winding
const QUIET_SLOTS = [1, N_SLOTS - 1]; // clear gaps flanking the fiducial
// Slots reserved each side of a self-crossing. Measured: margin 0 leaves a clean
// gap on the crossing's own slot (a useful landmark) while keeping median ~21
// usable slots of 32; margin 1 collapsed usable slots to ~9 (crossings come in
// pairs and shapes cross ~4–6×), starving the frame. Keep 0.
const SEED_SEARCH_CAP = 200; // deterministic code-profile search (see buildCodeRing)
// Two constants govern thickness-overlap gapping (kept separate from each other
// and tuned for good capacity):
//  - SEP_DIST: how far apart along the ARC two points must be to count as
//    different sections (generous, so local curves aren't false-flagged).
//  - OVERLAP_DIST: how close in SPACE those different sections must be to overlap.
//    It also doubles as the visual band width, so the lanes fill exactly the
//    overlap-free width (no edge-case overlap).
const SEP_DIST = STROKE * 1.5;
// Band width / overlap threshold. The flower's neighbouring sweeps sit ~1.45×
// STROKE apart, so capacity falls off a cliff past here (measured: >=12 usable
// slots drops 63%→54%→24% across 1.25×/1.3×/1.4×, ~0% by 1.5×). 1.3× widens the
// ribbon a touch past the original 1.25× without trading in extra keep-out gaps,
// and the seed-search still lands a frame in ~2 tries.
const OVERLAP_DIST = STROKE * 1.3;

// ---- Visual tunables (App-Clip-style "contour lanes" along the flower) ---
// The stroke band holds LANES thin lines that follow the SAME path at stepped
// radial offsets (concentric contour lines, App-Clip-like, but bent along the
// flower). Each line is broken by the data: per slot, a vertical on/off PATTERN
// across the lanes; consecutive "on" slots MERGE into one continuous arc (exactly
// how App-Clip arcs form), and a per-lane phase STAGGER keeps the breaks from
// lining up. Data is purely presence (colour-independent); colour is sampled
// from the ring's own field so it reads as the ring seen through a dash mask.
const LANES = 7; // concentric contour lines across the band (== PATTERNS width)
// Visual spread = the overlap distance, so the lanes FILL the available width
// without spilling past where overlaps are gapped (no edge-case overlap).
const BAND = OVERLAP_DIST;
// Thick lines, near-touching, so the band reads as a FILLED ribbon (not thin
// stripes with white gaps). 0.95 leaves a hairline between lanes so it still
// reads as contour lines rather than a solid blob.
const DASH_W = (BAND / LANES) * 0.95;
const STAGGER = 0.8; // per-lane phase, as a fraction of a slot
// Vertical on/off pattern across the LANES for each 3-bit symbol (0..7). Mostly
// dense (so lines fill the band) but each with a different break, for variety;
// consecutive on-slots merge into flowing arcs and stay decodable.
const PATTERNS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 0, 1, 1, 1],
  [1, 1, 0, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 1],
  [0, 1, 1, 1, 1, 1, 0],
  [1, 0, 1, 1, 1, 0, 1],
];

const f2 = (v: number) => v.toFixed(2);

// =========================================================================
// 1. Codec — payload integer ↔ symbol stream (Hamming(7,4) single-error ECC)
// =========================================================================
// Symbols are integers 0..3 (2 bits). Frame data bits = [version | payload],
// nibble-Hamming-encoded, then chunked into symbols. Pure + deterministic.

const DATA_BITS = VERSION_BITS + PAYLOAD_BITS;
const N_NIBBLES = Math.ceil(DATA_BITS / 4);
const CODE_BITS = N_NIBBLES * 7;
export const SYMBOL_COUNT = Math.ceil(CODE_BITS / BITS_PER_SLOT);

const toBits = (value: number, width: number): number[] => {
  const out: number[] = [];
  for (let i = width - 1; i >= 0; i--) out.push((value >>> i) & 1);
  return out;
};
const fromBits = (bits: number[]): number => bits.reduce((a, b) => a * 2 + b, 0);

// Hamming(7,4): 4 data bits → 7 code bits (corrects any single-bit error).
const hammingEncode = (d: number[]): number[] => {
  const [d0, d1, d2, d3] = d;
  const p1 = d0 ^ d1 ^ d3;
  const p2 = d0 ^ d2 ^ d3;
  const p4 = d1 ^ d2 ^ d3;
  return [p1, p2, d0, p4, d1, d2, d3]; // positions 1..7
};
const hammingDecode = (c: number[]): number[] => {
  const b = c.slice();
  const s1 = b[0] ^ b[2] ^ b[4] ^ b[6];
  const s2 = b[1] ^ b[2] ^ b[5] ^ b[6];
  const s4 = b[3] ^ b[4] ^ b[5] ^ b[6];
  const syn = s1 + (s2 << 1) + (s4 << 2);
  if (syn >= 1 && syn <= 7) b[syn - 1] ^= 1; // flip the erroring bit
  return [b[2], b[4], b[5], b[6]]; // d0 d1 d2 d3
};

export type CodeFrame = { version: number; payload: number; symbols: number[] };

/** Encode a payload integer into the fixed-length symbol stream. */
export function encodeSymbols(payload: number, version = VERSION): number[] {
  if (payload < 0 || payload >= 2 ** PAYLOAD_BITS) {
    throw new RangeError(`payload must be 0..${2 ** PAYLOAD_BITS - 1}`);
  }
  const data = [...toBits(version, VERSION_BITS), ...toBits(payload, PAYLOAD_BITS)];
  while (data.length < N_NIBBLES * 4) data.push(0); // pad to whole nibbles
  const code: number[] = [];
  for (let n = 0; n < N_NIBBLES; n++) code.push(...hammingEncode(data.slice(n * 4, n * 4 + 4)));
  while (code.length % BITS_PER_SLOT) code.push(0); // pad to whole symbols
  const symbols: number[] = [];
  for (let i = 0; i < code.length; i += BITS_PER_SLOT) {
    symbols.push(fromBits(code.slice(i, i + BITS_PER_SLOT)));
  }
  return symbols;
}

/** Inverse of `encodeSymbols` — recovers {version, payload} (ECC-corrected). */
export function decodeFrame(symbols: number[]): { version: number; payload: number } {
  const code: number[] = [];
  for (const s of symbols.slice(0, SYMBOL_COUNT)) code.push(...toBits(s, BITS_PER_SLOT));
  const data: number[] = [];
  for (let n = 0; n < N_NIBBLES; n++) data.push(...hammingDecode(code.slice(n * 7, n * 7 + 7)));
  return {
    version: fromBits(data.slice(0, VERSION_BITS)),
    payload: fromBits(data.slice(VERSION_BITS, VERSION_BITS + PAYLOAD_BITS)),
  };
}

// =========================================================================
// 2. Geometry helpers — self-crossings + per-point normals (code-only)
// =========================================================================
type Pts = { px: number[]; py: number[] };

// Proper segment intersection test (shared endpoints excluded by the caller).
function segCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Arc-length indices (0..N) where the closed centre-line crosses itself. */
export function findSelfCrossings({ px, py }: Pts): number[] {
  const n = px.length;
  const hits: number[] = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent across the wrap
      const j2 = (j + 1) % n;
      if (segCross(px[i], py[i], px[i2], py[i2], px[j], py[j], px[j2], py[j2])) {
        hits.push(i, j);
      }
    }
  }
  return hits;
}

// Unit outward-ish normal at point i (perpendicular to the local tangent).
function normalAt({ px, py }: Pts, i: number): [number, number] {
  const n = px.length;
  const a = (i - 1 + n) % n;
  const b = (i + 1) % n;
  const tx = px[b] - px[a];
  const ty = py[b] - py[a];
  const len = Math.hypot(tx, ty) || 1;
  return [-ty / len, tx / len];
}

// =========================================================================
// 3. Slot layout — which slots are fiducial / quiet / keep-out / data
// =========================================================================
export type SlotKind = "fiducial" | "quiet" | "keepout" | "data";

// Slots whose UNDER strand must be gapped because the THICK band overlaps itself
// there. The centre-line alone only catches exact crossings, but a stroke of
// width ~BAND also overlaps where two far-apart sections merely pass CLOSE (tight
// concave necks, the flower's centre). We treat the ring as an outlined SOLID
// shape: for every pair of points close in space yet far along the arc, gap the
// lower-index (under) point's slot, so the higher-index (over) section stays
// continuous and the overlap reads as ONE woven path.
function overlapUnderSlots(pts: Pts): Set<number> {
  const { px, py } = pts;
  const N = px.length;
  const per = N / N_SLOTS;
  let perim = 0;
  for (let i = 0; i < N; i++) perim += Math.hypot(px[(i + 1) % N] - px[i], py[(i + 1) % N] - py[i]);
  const minSep = Math.max(2, Math.round((N * SEP_DIST) / (perim || 1))); // "same section" arc gap
  const thr2 = OVERLAP_DIST ** 2; // gap as soon as the bands would touch
  const under = new Set<number>();
  for (let i = 0; i < N; i++) {
    for (let j = i + minSep; j < N; j++) {
      if (i === 0 && j > N - minSep) continue; // wrap-adjacent
      const dx = px[i] - px[j];
      const dy = py[i] - py[j];
      if (dx * dx + dy * dy < thr2) {
        under.add(Math.floor(i / per) % N_SLOTS); // gap the under (lower-index) section
        break;
      }
    }
  }
  return under;
}

/**
 * Classify all N_SLOTS for a given centre-line (deterministic for a shape).
 * Fiducial + quiet zones, then gap the under strand of every self-overlap
 * (crossing OR thickness near-pass) so crossings read as a clean single path.
 */
export function layoutSlots(pts: Pts): SlotKind[] {
  const kind: SlotKind[] = new Array(N_SLOTS).fill("data");
  kind[FIDUCIAL_SLOT] = "fiducial";
  for (const q of QUIET_SLOTS) kind[q] = "quiet";
  for (const slot of overlapUnderSlots(pts)) if (kind[slot] === "data") kind[slot] = "keepout";
  return kind;
}

// =========================================================================
// 4. Build — payload → shape + frame + per-slot glyph plan
// =========================================================================
export type SlotGlyph = { slot: number; symbol: number; data: boolean };
export type CodeRing = {
  payload: number;
  version: number;
  seedK: number; // which seed in the code-profile search produced this shape
  hover: Hover; // the shape's hover — lets the renderer sample the ring's colour
  pts: Pts;
  kinds: SlotKind[];
  glyphs: SlotGlyph[]; // every usable slot (data + filler), drawn as a dash rung
  dataSlots: number[];
};

// One candidate shape for a (payload, k): centre-line + slot classification.
function candidate(
  payload: number,
  k: number,
): { hover: Hover; pts: Pts; kinds: SlotKind[]; dataSlots: number[] } {
  const hover = makeHover(`stmcode:${payload}:${k}`);
  const pts = centreLine(SETTLE_POSE.t, SETTLE_POSE.twistT, SETTLE_POSE.morph, hover, N_POINTS);
  const kinds = layoutSlots(pts);
  const dataSlots = kinds.flatMap((kind, s) => (kind === "data" ? [s] : []));
  return { hover, pts, kinds, dataSlots };
}

/**
 * Build the full plan for a payload.
 *
 * CODE PROFILE (the "tune the rules" step, done entirely outside the core):
 * the brand's default shapes self-cross ~4–6× and most can't host a full frame,
 * so we walk a DETERMINISTIC seed sequence `stmcode:<payload>:<k>` and take the
 * first shape with enough usable slots. The shape still derives only from the
 * payload, so it authenticates the id AND the decoder/verifier can replay the
 * identical search from the recovered payload — no extra field to store.
 */
export function buildCodeRing(payload: number, version = VERSION): CodeRing {
  if (payload < 0 || payload >= 2 ** PAYLOAD_BITS) {
    throw new RangeError(`payload must be 0..${2 ** PAYLOAD_BITS - 1}`);
  }
  let chosen = candidate(payload, 0);
  let chosenK = 0;
  if (chosen.dataSlots.length < SYMBOL_COUNT) {
    for (let k = 1; k < SEED_SEARCH_CAP; k++) {
      const c = candidate(payload, k);
      if (c.dataSlots.length > chosen.dataSlots.length) {
        chosen = c; // keep best-so-far
        chosenK = k;
      }
      if (c.dataSlots.length >= SYMBOL_COUNT) break;
    }
  }
  const { hover, pts, kinds, dataSlots } = chosen;
  if (dataSlots.length < SYMBOL_COUNT) {
    throw new Error(
      `no code-friendly shape for payload ${payload} within ${SEED_SEARCH_CAP} seeds ` +
        `(best ${dataSlots.length}/${SYMBOL_COUNT} usable slots)`,
    );
  }
  const symbols = encodeSymbols(payload, version);
  const glyphs: SlotGlyph[] = dataSlots.map((slot, i) => {
    const isData = i < symbols.length;
    // Spare slots get deterministic filler symbols so the field stays full and
    // varied; the decoder reads only the first SYMBOL_COUNT data slots in order,
    // so filler is safely ignored.
    const symbol = isData ? symbols[i] : (slot * 7 + payload) & 3;
    return { slot, symbol, data: isData };
  });
  return { payload, version, seedK: chosenK, hover, pts, kinds, glyphs, dataSlots };
}

// =========================================================================
// 5. Render — plan → self-contained SVG string (App-Clip-style contour lanes)
// =========================================================================
// LANES thin lines follow the path at stepped radial offsets. Per slot, a
// vertical on/off PATTERN (from the symbol) decides which lanes are "on"; runs of
// consecutive on-slots in a lane MERGE into one continuous arc (App-Clip arcs),
// and a per-lane phase STAGGER offsets the breaks. Keep-out (under-strand) slots
// are off, so crossings read as a clean single woven path. Colour is sampled
// from the ring's own field — the ring seen through a dash mask.
// Lane CENTRES span (BAND - DASH_W), so once each lane is stroked DASH_W thick
// the outer edges land exactly on ±BAND/2 — the painted ink fills the full
// overlap-free band with NO spill past it (the old code spanned the whole BAND,
// so ink reached BAND + DASH_W and overlapped neighbours by ~half a stroke).
const laneOffset = (l: number): number => (l / (LANES - 1) - 0.5) * (BAND - DASH_W);

// Polyline along the path over centre index range [a,b], at radial offset `off`.
// ANTI-FOLD: where the path curves tighter than |off| (hairpin tips), the offset
// curve folds back on itself — which would draw an ugly straight cross-over. We
// detect the reversal (offset step opposing the centre step) and BREAK the line
// there (new sub-path) instead, so folds read as a clean gap, not a stray line.
function offsetPolyline(pts: Pts, a: number, b: number, off: number): string {
  const N = pts.px.length;
  let d = "";
  let px = 0;
  let py = 0;
  let cx = 0;
  let cy = 0;
  let started = false;
  for (let i = a; i <= b; i++) {
    const k = ((i % N) + N) % N;
    const [nx, ny] = normalAt(pts, k);
    const x = pts.px[k] + nx * off;
    const y = pts.py[k] + ny * off;
    if (!started) {
      d += `M${f2(x)},${f2(y)}`;
      started = true;
    } else {
      const folded = (x - px) * (pts.px[k] - cx) + (y - py) * (pts.py[k] - cy) <= 0;
      d += `${folded ? "M" : "L"}${f2(x)},${f2(y)}`;
    }
    px = x;
    py = y;
    cx = pts.px[k];
    cy = pts.py[k];
  }
  return d;
}

const isOn = (kind: SlotKind, symbol: number | undefined, lane: number): boolean =>
  kind === "data" && PATTERNS[symbol ?? 0][lane] === 1;

export type RenderOpts = {
  size?: number;
  background?: string;
  mono?: string; // single colour for the whole code (color-independent display)
  grayscale?: boolean; // sample the ring's grey field
  white?: boolean; // sample the ring's white (opacity) field
};

/** Render a pre-built plan to a self-contained SVG string (no rebuild). */
export function renderCodeRingSVG(ring: CodeRing, opts: RenderOpts = {}): string {
  const mono = opts.mono ?? null;
  // Colour each mark with the ring's OWN displayed colour at that position.
  const colors = mono
    ? null
    : sampleRingColors(
        SETTLE_POSE.twistT,
        SETTLE_POSE.morph,
        ring.hover,
        ring.pts.px,
        opts.grayscale ?? false,
        opts.white ?? false,
      );
  const { pts, kinds } = ring;
  const N = pts.px.length;
  const per = N / N_SLOTS;
  const symBySlot = new Map(ring.glyphs.map((g) => [g.slot, g.symbol]));
  const colorAt = (idx: number) => mono ?? colors![((idx % N) + N) % N];
  const cap = `stroke-linecap="round" stroke-linejoin="round"`;

  let body = "";
  for (let l = 0; l < LANES; l++) {
    const off = laneOffset(l);
    const phase = (l / LANES) * per * STAGGER; // stepped per-lane offset
    let runStart = -1;
    for (let s = 0; s <= N_SLOTS; s++) {
      const on = s < N_SLOTS && isOn(kinds[s], symBySlot.get(s), l);
      if (on && runStart < 0) runStart = s;
      if (!on && runStart >= 0) {
        // merge the [runStart..s-1] on-slots into one continuous arc
        const a = Math.round(runStart * per + phase);
        const b = Math.round((s - 1 + 1) * per + phase);
        body += `<path d="${offsetPolyline(pts, a, b, off)}" fill="none" stroke="${colorAt((a + b) >> 1)}" stroke-width="${f2(DASH_W)}" ${cap}/>`;
        runStart = -1;
      }
    }
  }

  // Fiducial: NO added mark (no blob). The fiducial + quiet slots leave a clean
  // wide angular GAP — the widest break in the otherwise-filled ring — which
  // fixes the origin. (Winding is fixed by the asymmetric data layout.)

  const size = opts.size ?? VIEW_W;
  const bg = opts.background ? `<rect width="100%" height="100%" fill="${opts.background}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(size)}" height="${f2((size * VIEW_H) / VIEW_W)}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">` +
    `${bg}${body}</svg>`
  );
}

/** Top-level: payload integer → a complete, deterministic code-ring SVG string. */
export function encodeRingCode(payload: number, opts: RenderOpts = {}): string {
  return renderCodeRingSVG(buildCodeRing(payload), opts);
}
