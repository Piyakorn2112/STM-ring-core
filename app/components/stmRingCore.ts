/**
 * stmRingCore — pure, framework-agnostic engine for the Srang Tech Mai ring.
 * Single source of truth for the live preview AND a static per-id exporter.
 *
 * CONCEPT: a charged wire, idle but ready, that resolves into shapes.
 *
 * GEOMETRY — the centre-line is the base circle plus a small seed-tuned low-
 * order drift and seed-chosen epicycles. A finite Fourier sum is C∞ smooth
 * (no cusps / corners can form); the dominant
 * epicycle is opened to |k1·a1| ≈ φ (golden ratio) so its loop self-crosses
 * cleanly. The base is shrunk by (a1+a2) so |z| ≤ R and it never leaves frame.
 *
 * RENDERING — the wire is emitted as K ordered "strand" pieces. Drawing them in
 * order gives real over/under depth at the crossings (no outline, no mask). Each
 * strand carries a multi-stop gradient sampled at EVERY centre-line vertex, so
 * the colour is dense/oversampled and reads perfectly smooth at any zoom.
 *
 * COLOUR — most of the wire is the dark "default" gradient; a seed-chosen
 * ~42–54% arc lights up and DRIFTS around the loop (energy flowing). The lit
 * arc is a vivid brand
 * primary in its core with mostly neon complementary fringes and an occasional
 * monochromatic variant. Its transition fringes fade by opacity again, with
 * extra chroma as they thin out, while anything outside the charge window
 * stays transparent.
 * Grayscale swaps in greys.
 */

// ---- Fixed geometry, matched 1:1 to the source SVG ----------------------
export const VIEW_W = 176;
export const VIEW_H = 171;
export const CX = 88.9;
export const CY = 85.6;
export const R_MID = 63.0;
export const STROKE = 18.6;
export const N_LIVE = 700; // centre-line samples (live)
export const N_EXPORT = 700; // centre-line samples (export)
export const K_LIVE = 360; // strand pieces (live) — over/under resolution
export const K_EXPORT = 360; // strand pieces (export)

export const GRAD_X1 = CX - 72.3; // dark "default" ramp: light here …
export const GRAD_X2 = CX + 72.3; // … dark here
export const DARK_BASE = ["#4e4e4e", "#000000"]; // the smooth default-ring stops
const TAU = Math.PI * 2;

const CHARGE_FRAC_MIN = 0.42; // shortest hashed lit-arc fraction at full twist
const CHARGE_FRAC_MAX = 0.54; // longest hashed lit-arc fraction at full twist
const CHARGE_EDGE = 0.12; // smoothness of the charge's leading/trailing fade
const CHARGE_FADE_SAT_BOOST = 0.35; // extra chroma as the fading edge thins out

// =========================================================================
// Colour maths — sRGB ↔ OKLab (Björn Ottosson) + graceful gamut mapping
// =========================================================================
type Lab = { L: number; a: number; b: number };

const srgbToLin = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const linToByte = (c: number): number => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
function linRgbToOklab(r: number, g: number, b: number): Lab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}
function oklabToLin(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb: [number, number, number]): boolean =>
  rgb[0] >= -0.001 && rgb[0] <= 1.001 &&
  rgb[1] >= -0.001 && rgb[1] <= 1.001 &&
  rgb[2] >= -0.001 && rgb[2] <= 1.001;

// OKLab → "rgb()", pushing chroma to the sRGB gamut edge (so vivid stays vivid,
// only desaturating the last bit needed to be displayable — never going muddy).
function oklabToCss({ L, a, b }: Lab): string {
  if (!inGamut(oklabToLin(L, a, b))) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLin(L, a * mid, b * mid))) lo = mid;
      else hi = mid;
    }
    a *= lo;
    b *= lo;
  }
  const [r, g, bl] = oklabToLin(L, a, b);
  return `rgb(${linToByte(r)},${linToByte(g)},${linToByte(bl)})`;
}
const hexToOklab = (hex: string): Lab => {
  const n = parseInt(hex.slice(1), 16);
  return linRgbToOklab(
    srgbToLin((n >> 16) & 255),
    srgbToLin((n >> 8) & 255),
    srgbToLin(n & 255),
  );
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number) => t * t * (3 - 2 * t);
const mixLab = (x: Lab, y: Lab, t: number): Lab => ({
  L: lerp(x.L, y.L, t),
  a: lerp(x.a, y.a, t),
  b: lerp(x.b, y.b, t),
});
const scaleLabChroma = ({ L, a, b }: Lab, scale: number): Lab => ({
  L,
  a: a * scale,
  b: b * scale,
});


// =========================================================================
// Seeding — hash any employee id (string or number) → deterministic stream.
// =========================================================================
function hashId(input: number | string): number {
  const str = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randomSeed = (): number => (Math.random() * 2 ** 31) >>> 0;

// Composition "magic numbers".
const PHI = 1.618033988749895; // golden ratio
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.5° — most irrational turn
export const PALETTE = ["#5057FF", "#3B86FF", "#FB5607"]; // the 3 company colours

type Harmonic = { k: number; amp: number; speed: number; phase: number };
type BaseFlow = {
  harmonics: Harmonic[];
  timeOffset: number;
  breatheAmp: number;
  breatheSpeed: number;
  breathePhase: number;
};

type Twist = {
  a1: number;
  k1: number;
  phase1: number;
  w1: number;
  a2: number;
  k2: number;
  phase2: number;
  w2: number;
  // Optional third epicycle — one more rung of the SAME golden cascade. a3 is 0
  // for the archetypes that don't use it, so they keep their two-term geometry.
  a3: number;
  k3: number;
  phase3: number;
  w3: number;
  spin: number;
  spinSpeed: number;
};

// The lit-arc palette: a vivid primary core with mostly complementary fringes.
type Charge = { primary: Lab; compA: Lab; compB: Lab };

export type Hover = {
  baseFlow: BaseFlow;
  charge: Charge;
  colorPhase: number; // where the lit arc starts (0..1 of the wire)
  colorDrift: number; // its travel speed — energy flowing along the wire
  chargeFrac: number; // hashed fraction of the wire that lights up at full twist
  twist: Twist;
};

const GREY_CHARGE: Charge = {
  primary: linRgbToOklab(...greyLin(0xd2)),
  compA: linRgbToOklab(...greyLin(0x8c)),
  compB: linRgbToOklab(...greyLin(0x8c)),
};
function greyLin(v: number): [number, number, number] {
  const g = srgbToLin(v);
  return [g, g, g];
}

// White ("opacity-based") variant — matches the brand logo's ring, which is a
// pure-white wire whose depth/sheen is carried by ALPHA, not colour. The whole
// wire becomes white; the dark base gradient becomes a white opacity ramp, and
// the charge stays white with its existing fade. (Opacity, not colour.)
const WHITE_LAB: Lab = linRgbToOklab(1, 1, 1);
// dk base gradient as white-with-alpha: bright "light" end → faint "dark" end,
// mirroring DARK_BASE (#4e4e4e→#000) but expressed purely as opacity.
export const WHITE_BASE_OPACITY: [number, number] = [0.95, 0.84];
// "Contrast" single-colour variant — same tinted charge as transparency, but the
// (unlit) base is pushed much fainter, so the solid charged arc reads sharply
// against an almost-transparent remainder of the ring. Higher solid/clear split.
export const CONTRAST_BASE_OPACITY: [number, number] = [0.3, 0.1];

// Wavenumbers that yield EXACT n-fold rotational symmetry. A closed Fourier
// curve Σ cₖ·e^{ikθ} is Cₙ iff every present harmonic k ≡ 1 (mod n) — the base
// circle is k=1, so the epicycles must be drawn from this set. Returns |k|≥2
// sorted by |k| (the low ones are the cleanest, lowest-curvature lobes).
function symAllowed(n: number): number[] {
  const out: number[] = [];
  for (let j = -4; j <= 4; j++) {
    const k = 1 + j * n;
    if (Math.abs(k) >= 2) out.push(k);
  }
  return out.sort((a, b) => Math.abs(a) - Math.abs(b));
}

// Symmetry orders, weighted toward the LOWER (more shape-like, varied) folds.
// 2/3/4 (rect, triangle, square) are common; 5/6 (busier rosettes) are rarer so
// high-fold symmetry doesn't dominate. (Tune by changing the multiplicities.)
const SYM_ORDERS = [2, 2, 2, 3, 3, 4, 4, 5, 6];

export function makeHover(id: number | string): Hover {
  const r = mulberry32(hashId(id));
  const drift = (lo: number, hi: number) =>
    (lo + r() * (hi - lo)) * (r() < 0.5 ? -1 : 1);

  // Symmetry order: ~45% of seeds lock to EXACT n-fold rotational symmetry
  // (n ∈ 2..6) by drawing every harmonic from the residue class k ≡ 1 (mod n);
  // the rest stay free-form. Symmetry depends only on WHICH harmonics are present
  // (not their phase/amplitude), so these shapes stay provably Cₙ while they spin,
  // breathe and drift. The base wobble is silenced for them so symmetry reads crisp.
  const sym = r() < 0.38 ? SYM_ORDERS[(r() * SYM_ORDERS.length) | 0] : 0; // 0 = free-form, else Cₙ

  // Seed the idle drift by varying the same low-order base harmonics. This
  // loosens the flow without changing the existing knob counts.
  const baseFlow: BaseFlow = {
    harmonics: SHAPE.map((h, index) => ({
      k: h.k,
      amp: h.amp * ((index === 0 ? 0.92 : 0.84) + r() * 0.22) * (sym ? 0 : 1),
      speed: h.speed * (0.92 + r() * 0.22),
      phase: h.phase + drift(0.12, 0.62),
    })),
    timeOffset: r() * TAU,
    breatheAmp: 0.03 + r() * 0.05,
    breatheSpeed: 0.18 + r() * 0.2,
    breathePhase: r() * TAU,
  };

  // --- vivid charge palette ---------------------------------------------
  // so the colour stays as vivid as sRGB can show. Most seeds use hotter
  // complementary fringes; a small minority keep same-hue monochromatic edges.
  // Blue-family primaries bias toward brighter, cleaner neon complements so
  // they do not collapse into olive/brown after gamut mapping.
  const baseIndex = (r() * PALETTE.length) | 0;
  const p = hexToOklab(PALETTE[baseIndex]);
  const isBluePrimary = baseIndex < 2;
  const H0 = Math.atan2(p.b, p.a);
  const Lp = Math.min(0.72, Math.max(0.58, p.L + 0.06));
  const Cp = 0.32; // high; gamut-mapped per hue ⇒ maximally vivid
  const at = (hue: number, L: number, C = Cp) => ({
    L,
    a: C * Math.cos(hue),
    b: C * Math.sin(hue),
  });
  const edgeAL = Math.min(
    isBluePrimary ? 0.86 : 0.82,
    Lp + (isBluePrimary ? 0.06 : 0.04) + r() * (isBluePrimary ? 0.06 : 0.05),
  );
  const edgeBL = Math.max(
    isBluePrimary ? 0.5 : 0.4,
    Lp - ((isBluePrimary ? 0.05 : 0.1) + r() * (isBluePrimary ? 0.05 : 0.08)),
  );
  const edgeAC = Cp * ((isBluePrimary ? 0.96 : 0.82) + r() * (isBluePrimary ? 0.18 : 0.14));
  const edgeBC = Cp * ((isBluePrimary ? 1.12 : 1.02) + r() * (isBluePrimary ? 0.24 : 0.18));
  const off = (isBluePrimary ? [0.62, 0.62, 2.094] : [0.62, 2.094, 2.618])[(r() * 3) | 0]; // ~35° · 120° · 150°
  const useMonochrome = r() < 0.14;
  const edgeHueA = useMonochrome ? H0 : H0 - off;
  const edgeHueB = useMonochrome ? H0 : H0 + off;
  const charge: Charge = {
    primary: at(H0, Lp),
    compA: at(edgeHueA, edgeAL, edgeAC),
    compB: at(edgeHueB, edgeBL, edgeBC),
  };
  const colorPhase = r();
  const colorDrift = (0.03 + r() * 0.05) * (r() < 0.5 ? -1 : 1);
  const chargeFrac = CHARGE_FRAC_MIN + r() * (CHARGE_FRAC_MAX - CHARGE_FRAC_MIN);

  // --- shape twist -------------------------------------------------------
  // Two families share one engine. Both keep the golden law (|k1·a1| ≈ φ), the
  // cascade caps and the low-curvature rule, so symmetric and free shapes read
  // as the same system.
  let k1: number, a1: number, k2: number, a2: number, k3: number, a3: number;
  let phase1: number, phase2: number;

  if (sym) {
    // Cₙ family: base circle (k=1) + a dominant epicycle (one of the two
    // smallest allowed wavenumbers, 1±n) + at most one LOW overtone, giving a
    // clean rounded n-gon / rosette that never breaks. Higher symmetry orders
    // keep only the single epicycle (their overtones are too high to flow).
    const allowed = symAllowed(sym);
    const i1 = r() < 0.5 ? 0 : 1;
    k1 = allowed[i1];
    a1 = (PHI * (0.86 + r() * 0.32)) / Math.abs(k1); // |k1·a1| ≈ φ
    const k2c = allowed[Math.min(i1 + 1 + ((r() * 2) | 0), allowed.length - 1)];
    const keep2 = Math.abs(k2c) <= 5 && Math.abs(k2c) !== Math.abs(k1);
    k2 = keep2 ? k2c : k1;
    a2 = keep2 ? Math.min(a1 / (PHI * PHI), 0.42 / Math.abs(k2)) : 0;
    k3 = 1; // a3 = 0 ⇒ no contribution; symmetric shapes use ≤ 2 epicycles
    a3 = 0;
    phase1 = r() * TAU;
    phase2 = phase1 + GOLDEN_ANGLE;
  } else {
    // Free-form family — the dominant golden epicycle (k1, |k1·a1| ≈ φ) plus a
    // seed-chosen archetype that recombines the overtones.
    const k1mag = 2 + ((r() * 4) | 0); // 2,3,4,5 → 1,2,3,4 loops
    k1 = (r() < 0.5 ? 1 : -1) * k1mag;
    a1 = (PHI * (0.86 + r() * 0.32)) / k1mag; // |k1·a1| ≈ φ
    phase1 = r() * TAU;

    const mode = (r() * 5) | 0; // 0 classic ·1 rosette ·2 counter ·3 resonant ·4 knot
    const hasThird = mode === 1 || mode === 4; // rosette & knot grow a 3rd epicycle

    // k2 overtone — neighbouring, or an octave (2·k1) for the resonant archetype.
    // The cascade cap (0.42/k2mag) keeps higher overtones small, so they read as
    // the same family — a finer/coarser scallop — while adding distinct silhouettes.
    const k2mag = mode === 3 ? k1mag * 2 : k1mag + 1 + ((r() * 5) | 0);
    // handedness: counter & knot oppose k1 (gear/star read); others stay random.
    const k2sign =
      mode === 2 || mode === 4 ? -Math.sign(k1) : r() < 0.5 ? 1 : -1;
    k2 = k2sign * k2mag;

    // third epicycle — a LOW-order lobe (k3mag 2..5), NOT a high overtone:
    // curvature ∝ k²·A and the spline break ∝ k³·A, while a3 = a2/φ² does not
    // shrink with k3mag, so a high third epicycle injects kinks the renderer
    // can't carry. Low k3 stays smooth. Knot opposes the lobe, rosette follows.
    const k3mag = 2 + ((r() * 4) | 0);
    a2 = Math.min(a1 / (PHI * PHI), 0.42 / k2mag);
    a3 = hasThird ? Math.min(a2 / (PHI * PHI), 0.42 / k3mag) : 0;
    k3 = (mode === 4 ? -Math.sign(k1) : Math.sign(k2)) * k3mag;
    phase2 = phase1 + GOLDEN_ANGLE;
  }

  const twist: Twist = {
    k1,
    a1,
    phase1,
    w1: drift(0.05, 0.11),
    k2,
    a2,
    phase2,
    w2: drift(0.05, 0.11),
    a3,
    k3,
    phase3: phase2 + GOLDEN_ANGLE,
    w3: drift(0.05, 0.11),
    spin: r() * TAU,
    spinSpeed: drift(0.04, 0.09),
  };

  return { baseFlow, charge, colorPhase, colorDrift, chargeFrac, twist };
}

const chargeOf = (h: Hover, grayscale: boolean): Charge =>
  grayscale ? GREY_CHARGE : h.charge;

// Colour across the lit arc: primary plateau in the middle, mostly
// complementary tones toward the (fading) edges. `localU` ∈ [0,1] spans the lit window.
function litLab(localU: number, c: Charge): Lab {
  if (localU < 0.32) return mixLab(c.compA, c.primary, smooth(localU / 0.32));
  if (localU > 0.68) return mixLab(c.primary, c.compB, smooth((localU - 0.68) / 0.32));
  return c.primary;
}

// =========================================================================
// Idle morph + geometry helpers
// =========================================================================
const SHAPE: Harmonic[] = [
  { k: 2, amp: 0.95, speed: 0.54, phase: 0.0 },
  { k: 3, amp: 0.5, speed: 0.7, phase: 1.7 },
];
const waveSum = (hs: Harmonic[], th: number, t: number): number => {
  let s = 0;
  for (const h of hs) s += h.amp * Math.sin(h.k * th - h.speed * t + h.phase);
  return s;
};
const f2 = (v: number) => v.toFixed(2);

function resampleClosed(
  rx: number[],
  ry: number[],
  M: number,
  N: number,
): [number[], number[]] {
  const s = new Array<number>(M + 1);
  s[0] = 0;
  for (let j = 0; j < M; j++) {
    const k = (j + 1) % M;
    s[j + 1] = s[j] + Math.hypot(rx[k] - rx[j], ry[k] - ry[j]);
  }
  const total = s[M] || 1;
  const qx = new Array<number>(N);
  const qy = new Array<number>(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * total;
    while (seg < M - 1 && s[seg + 1] < target) seg++;
    const segLen = s[seg + 1] - s[seg] || 1;
    const f = (target - s[seg]) / segLen;
    const k = (seg + 1) % M;
    qx[i] = rx[seg] + (rx[k] - rx[seg]) * f;
    qy[i] = ry[seg] + (ry[k] - ry[seg]) * f;
  }
  return [qx, qy];
}

function roundSharpCorners(px: number[], py: number[], n: number, s: number): void {
  if (s <= 0) return;
  const THRESH = Math.PI / 3;
  const nx = new Array<number>(n);
  const ny = new Array<number>(n);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const v1x = px[i] - px[a];
      const v1y = py[i] - py[a];
      const v2x = px[b] - px[i];
      const v2y = py[b] - py[i];
      const turn = Math.atan2(
        Math.abs(v1x * v2y - v1y * v2x),
        v1x * v2x + v1y * v2y,
      );
      let w = (turn - THRESH) / (Math.PI - THRESH);
      w = (w < 0 ? 0 : w > 1 ? 1 : w) * 0.5 * s;
      nx[i] = px[i] + ((px[a] + px[b]) * 0.5 - px[i]) * w;
      ny[i] = py[i] + ((py[a] + py[b]) * 0.5 - py[i]) * w;
    }
    for (let i = 0; i < n; i++) {
      px[i] = nx[i];
      py[i] = ny[i];
    }
  }
}

// One ordered CHARGE strand over the dark base: a smooth sub-path + a dense
// per-vertex gradient of the lit colour itself. Opacity carries the smooth edge
// fade, and the fading edge gets a small chroma lift so it stays energetic.
export type Strand = {
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colors: string[]; // lit colour per vertex, with extra chroma on fading edges
  alphas: number[]; // opacity per vertex for the smooth charge fade
};
export type RingFrame = {
  d: string; // the whole wire — stroked once with the smooth dark base gradient
  strands: Strand[];
  width: number;
};

// 1) centre-line (epicycle, oversampled) → even arc-length resample → fair.
// Returns N fair points; isolated so two seeds can be morphed point-for-point.
function centreLine(
  t: number,
  twistT: number,
  morph: number,
  h: Hover,
  N: number,
): { px: number[]; py: number[] } {
  const flow = h.baseFlow;
  const tw = h.twist;
  const M = N * 2;
  const rx = new Array<number>(M);
  const ry = new Array<number>(M);
  const cShrink = Math.min(0.9, tw.a1 + tw.a2 + tw.a3);
  const baseAmp = 1 - cShrink * morph;
  const flowT = t + flow.timeOffset;
  const flowAmp = 1 + flow.breatheAmp * Math.sin(flow.breatheSpeed * t + flow.breathePhase);
  const A1 = R_MID * morph * tw.a1;
  const A2 = R_MID * morph * tw.a2;
  const A3 = R_MID * morph * tw.a3;
  const p1 = tw.phase1 + tw.w1 * twistT;
  const p2 = tw.phase2 + tw.w2 * twistT;
  const p3 = tw.phase3 + tw.w3 * twistT;
  const rot = tw.spin + tw.spinSpeed * twistT;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let j = 0; j < M; j++) {
    const th = (j / M) * TAU;
    const baseR = (R_MID + waveSum(flow.harmonics, th, flowT) * flowAmp) * baseAmp;
    const zx =
      baseR * Math.cos(th) +
      A1 * Math.cos(tw.k1 * th + p1) +
      A2 * Math.cos(tw.k2 * th + p2) +
      A3 * Math.cos(tw.k3 * th + p3);
    const zy =
      baseR * Math.sin(th) +
      A1 * Math.sin(tw.k1 * th + p1) +
      A2 * Math.sin(tw.k2 * th + p2) +
      A3 * Math.sin(tw.k3 * th + p3);
    rx[j] = CX + zx * cr - zy * sr;
    ry[j] = CY + zx * sr + zy * cr;
  }
  const [px, py] = resampleClosed(rx, ry, M, N);
  roundSharpCorners(px, py, N, morph);
  return { px, py };
}

// 2) per-vertex lit colour (in OKLab, chroma-boosted on the fading edge) plus
// its opacity mask. Kept in OKLab so two seeds blend in a perceptual space.
function chargeField(
  twistT: number,
  morph: number,
  h: Hover,
  N: number,
  grayscale: boolean,
  white = false,
  // Optional single-colour override. When set (or `white`), every vertex takes
  // this one colour and the whole look becomes opacity-carried — generalising
  // the white variant to any tint. `undefined` ⇒ the original multi-colour
  // charge, so existing callers are byte-identical.
  tintLab?: Lab,
): { lab: Lab[]; alpha: number[] } {
  const c = chargeOf(h, grayscale);
  const phase = ((h.colorPhase + h.colorDrift * twistT) % 1 + 1) % 1;
  const chargeFrac = h.chargeFrac;
  const half = chargeFrac / 2;
  const lab: Lab[] = new Array(N);
  const alpha: number[] = new Array(N);
  const showCharge = morph > 0.0001;
  const tint = white ? WHITE_LAB : tintLab;
  for (let i = 0; i < N; i++) {
    const so = ((((i / N - phase) % 1) + 1.5) % 1) - 0.5; // signed circular dist
    const wd = Math.abs(so);
    const w = wd <= half - CHARGE_EDGE ? 1 : wd >= half ? 0 : smooth((half - wd) / CHARGE_EDGE);
    // Single-colour variant: one colour everywhere — the fade lives in alpha.
    if (tint) {
      lab[i] = tint;
    } else {
      const fadeEdge = smooth(1 - w);
      const lit = litLab(clamp01(so / chargeFrac + 0.5), c);
      lab[i] = scaleLabChroma(lit, 1 + CHARGE_FADE_SAT_BOOST * fadeEdge);
    }
    alpha[i] = showCharge ? w * morph : 0;
  }
  return { lab, alpha };
}

// 3) Emit the fair points + per-vertex colour as one dark base path plus K
// ordered charge strands (Catmull-Rom Béziers, dense per-vertex gradients).
function assemble(
  px: number[],
  py: number[],
  lab: Lab[],
  alpha: number[],
  N: number,
  K: number,
): RingFrame {
  const col = lab.map(oklabToCss);

  // Catmull-Rom Bézier segment i→i+1 (shared so pieces stay C1-continuous)
  const seg = (i: number): string => {
    const j = (i + 1) % N;
    const im1 = (i - 1 + N) % N;
    const ip2 = (i + 2) % N;
    const c1x = px[i] + (px[j] - px[im1]) / 6;
    const c1y = py[i] + (py[j] - py[im1]) / 6;
    const c2x = px[j] - (px[ip2] - px[i]) / 6;
    const c2y = py[j] - (py[ip2] - py[i]) / 6;
    return `C${f2(c1x)},${f2(c1y)} ${f2(c2x)},${f2(c2y)} ${f2(px[j])},${f2(py[j])}`;
  };

  // whole wire — stroked once with the smooth dark "default" gradient
  let d = `M${f2(px[0])},${f2(py[0])}`;
  for (let i = 0; i < N; i++) d += seg(i);
  d += "Z";

  // K ordered charge strands, each with a dense per-vertex colour ramp and a
  // binary opacity mask outside the active charge window.
  const step = Math.max(1, Math.round(N / K));
  const strands: Strand[] = [];
  for (let start = 0; start < N; start += step) {
    const end = Math.min(start + step, N);
    let sd = `M${f2(px[start])},${f2(py[start])}`;
    const colors: string[] = [col[start]];
    const alphas: number[] = [alpha[start]];
    for (let i = start; i < end; i++) {
      sd += seg(i);
      colors.push(col[(i + 1) % N]);
      alphas.push(alpha[(i + 1) % N]);
    }
    strands.push({
      d: sd,
      x1: px[start],
      y1: py[start],
      x2: px[end % N],
      y2: py[end % N],
      colors,
      alphas,
    });
  }

  return { d, strands, width: STROKE };
}

export function buildRing(
  t: number,
  twistT: number,
  morph: number,
  h: Hover,
  N = N_LIVE,
  K = K_LIVE,
  grayscale = false,
  white = false,
  tintLab?: Lab, // optional single-colour override (no-op when undefined)
): RingFrame {
  const { px, py } = centreLine(t, twistT, morph, h, N);
  const { lab, alpha } = chargeField(twistT, morph, h, N, grayscale, white, tintLab);
  return assemble(px, py, lab, alpha, N, K);
}

// Geometric morph between two seeds: build BOTH fair centre-lines and blend
// them point-for-point (and their lit colour in OKLab). Because the blend is on
// the resolved curve — not on the harmonic knobs — the loop counts of the two
// seeds need not match, so the wire flows naturally from any shape to any other.
// `blend`: 0 = seed A, 1 = seed B. The caller supplies the easing (values
// slightly past 1 are allowed — they extrapolate just beyond B for a bounce).
export function buildRingMorph(
  t: number,
  twistT: number,
  morph: number,
  hA: Hover,
  hB: Hover,
  blend: number,
  N = N_LIVE,
  K = K_LIVE,
  grayscale = false,
  white = false,
  tintLab?: Lab, // optional single-colour override (no-op when undefined)
): RingFrame {
  const e = blend;
  const A = centreLine(t, twistT, morph, hA, N);
  const B = centreLine(t, twistT, morph, hB, N);
  const px = new Array<number>(N);
  const py = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    px[i] = lerp(A.px[i], B.px[i], e);
    py[i] = lerp(A.py[i], B.py[i], e);
  }
  const fa = chargeField(twistT, morph, hA, N, grayscale, white, tintLab);
  const fb = chargeField(twistT, morph, hB, N, grayscale, white, tintLab);
  const lab: Lab[] = new Array(N);
  const alpha: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    lab[i] = mixLab(fa.lab[i], fb.lab[i], e);
    alpha[i] = lerp(fa.alpha[i], fb.alpha[i], e);
  }
  return assemble(px, py, lab, alpha, N, K);
}

export const REST_HOVER: Hover = makeHover(0);

// =========================================================================
// Static exporter — a self-contained SVG string for one id (e.g. employee ID).
// =========================================================================
// Inner SVG markup for ONE ring frame: `<defs>…</defs>` (the dark base + each
// charge strand's gradient) followed by the stroked paths. Pulled out of
// `exportSVG` so it can be reused, unchanged, for every cell of a tiled grid.
//
// `idPrefix` namespaces the gradient ids. SVG ids are document-global, so when
// many rings live in ONE document (the grid exporter) their `dk`/`g0`/`g1`…
// ids would otherwise collide and every cell would paint the first cell's
// colours. The default `""` makes single-ring output byte-identical to before.
// The three colour variances an export can take:
//  - "luminosity" — the original look: dark base gradient + multi-colour charge.
//  - "transparency" — a single tint everywhere, all depth/sheen carried by
//    OPACITY (the white variant, generalised to any colour); the path stays
//    clearly visible against light or dark backgrounds.
//  - "contrast" — like transparency, but the unlit base is far fainter, so the
//    solid charged arc and the near-transparent remainder split more distinctly.
//  - "flat" — one solid, fully-opaque colour; no gradients, no charge, no fade.
//    The smallest possible output (a single stroked path per ring).
export type ColorMode = "luminosity" | "transparency" | "contrast" | "flat";

// Internal resolution of the user-facing flags into a concrete paint plan.
// `white` is kept as its own kind for byte-identical back-compat.
type PaintSpec = {
  kind: "luminosity" | "white" | "transparency" | "contrast" | "flat";
  tintHex?: string; // transparency/contrast (base ramp) & flat (solid stroke)
  tintLab?: Lab; // transparency/contrast charge strands
};
function resolvePaint(opts: {
  white?: boolean;
  colorMode?: ColorMode;
  tint?: string;
}): PaintSpec {
  if (opts.white) return { kind: "white" };
  const mode = opts.colorMode ?? "luminosity";
  if (mode === "luminosity") return { kind: "luminosity" };
  const tintHex = opts.tint ?? "#000000";
  if (mode === "flat") return { kind: "flat", tintHex };
  if (mode === "contrast") return { kind: "contrast", tintHex, tintLab: hexToOklab(tintHex) };
  return { kind: "transparency", tintHex, tintLab: hexToOklab(tintHex) };
}
// The single-colour override `buildRing` needs for a given spec (charge strands).
const tintFor = (spec: PaintSpec): Lab | undefined =>
  spec.kind === "transparency" || spec.kind === "contrast" ? spec.tintLab : undefined;

function ringMarkup(fr: RingFrame, spec: PaintSpec, idPrefix = ""): string {
  const w = f2(fr.width);
  const cap = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  // Flat: one solid stroked path — no defs, no strands. Tiny and graphics-app
  // friendly (the big size win the single-colour modes are for).
  if (spec.kind === "flat") {
    return `<path d="${fr.d}" ${cap} stroke="${spec.tintHex}" stroke-width="${w}"/>`;
  }
  // The export must match the live renderer: one base stroked loop plus stroked
  // charge strands with dense per-stop colour and the smooth opacity fade.
  const stopStr = (s: Strand) =>
    s.colors
      .map(
        (c, i) =>
          `<stop offset="${(i / (s.colors.length - 1)).toFixed(4)}" stop-color="${c}" stop-opacity="${s.alphas[i].toFixed(3)}"/>`,
      )
      .join("");
  const opacityRamp = (hex: string, ops: [number, number] = WHITE_BASE_OPACITY) =>
    `<stop offset="0" stop-color="${hex}" stop-opacity="${ops[0]}"/><stop offset="1" stop-color="${hex}" stop-opacity="${ops[1]}"/>`;
  const baseStops =
    spec.kind === "white"
      ? opacityRamp("#fff")
      : spec.kind === "transparency"
        ? opacityRamp(spec.tintHex!)
        : spec.kind === "contrast"
          ? opacityRamp(spec.tintHex!, CONTRAST_BASE_OPACITY)
          : `<stop offset="0" stop-color="${DARK_BASE[0]}"/><stop offset="1" stop-color="${DARK_BASE[1]}"/>`;
  const dark = `<linearGradient id="${idPrefix}dk" gradientUnits="userSpaceOnUse" x1="${f2(GRAD_X1)}" y1="${f2(CY)}" x2="${f2(GRAD_X2)}" y2="${f2(CY)}">${baseStops}</linearGradient>`;
  const defs = fr.strands
    .map(
      (s, i) =>
        `<linearGradient id="${idPrefix}g${i}" gradientUnits="userSpaceOnUse" x1="${f2(s.x1)}" y1="${f2(s.y1)}" x2="${f2(s.x2)}" y2="${f2(s.y2)}">${stopStr(s)}</linearGradient>`,
    )
    .join("");
  const base = `<path d="${fr.d}" ${cap} stroke="url(#${idPrefix}dk)" stroke-width="${w}"/>`;
  const bodies = fr.strands
    .map(
      (s, i) =>
        `<path d="${s.d}" ${cap} stroke="url(#${idPrefix}g${i})" stroke-width="${w}"/>`,
    )
    .join("");
  return `<defs>${dark}${defs}</defs>${base}${bodies}`;
}

export function exportSVG(opts: {
  id?: number | string;
  morph?: number;
  t?: number;
  twistT?: number; // separate time for the epicycle twist (defaults to t)
  size?: number;
  background?: string;
  segments?: number;
  pieces?: number;
  grayscale?: boolean;
  white?: boolean;
  colorMode?: ColorMode; // luminosity (default) | transparency | flat
  tint?: string; // hex for transparency / flat (default "#000000")
} = {}): string {
  const morph = opts.morph ?? (opts.id == null ? 0 : 1);
  const hover = opts.id == null ? REST_HOVER : makeHover(opts.id);
  const tt = opts.t ?? 0;
  const spec = resolvePaint(opts);
  const fr = buildRing(
    tt,
    opts.twistT ?? tt,
    morph,
    hover,
    opts.segments ?? N_EXPORT,
    spec.kind === "flat" ? 1 : opts.pieces ?? K_EXPORT,
    opts.grayscale ?? false,
    spec.kind === "white",
    tintFor(spec),
  );
  const size = opts.size ?? VIEW_W;
  const bg = opts.background
    ? `<rect width="100%" height="100%" fill="${opts.background}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(size)}" height="${f2(
    (size * VIEW_H) / VIEW_W,
  )}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">${bg}${ringMarkup(fr, spec)}</svg>`;
}

// The same baked-in settling math `exportThumbnailSVG` uses, exposed so the grid
// exporter renders every cell at the identical "settled static" pose.
const SETTLE_T = 10;
const SETTLE_TAU = 0.22;
const SETTLE_PROGRESS = 1 - Math.exp(-SETTLE_T / SETTLE_TAU);
const SETTLE_POSE = {
  morph: SETTLE_PROGRESS, // TARGET_MORPH = 1
  t: SETTLE_T,
  twistT: SETTLE_T - SETTLE_TAU * SETTLE_PROGRESS,
};

// =========================================================================
// Grid exporter — tile many deterministic rings into ONE self-contained SVG.
// =========================================================================
// Every cell is a nested `<svg>` viewport (its own `viewBox 0 0 VIEW_W VIEW_H`),
// so each ring keeps the engine's native coordinates and is simply placed and
// scaled into its slot. Gradient ids are prefixed per cell (`c0_`, `c1_`, …) so
// the cells don't share colours. The whole thing is one downloadable document.
export function exportGridSVG(opts: {
  rows?: number;
  cols?: number;
  cellSize?: number; // ring render width in px (height follows the 176:171 ratio)
  xGap?: number; // horizontal gap between cells, px
  yGap?: number; // vertical gap between cells, px
  padding?: number; // outer margin around the whole grid, px
  segments?: number; // centre-line samples per ring (N)
  pieces?: number; // over/under strand pieces per ring (K)
  grayscale?: boolean;
  white?: boolean;
  colorMode?: ColorMode; // luminosity (default) | transparency | flat
  tint?: string; // hex for transparency / flat (default "#000000")
  background?: string; // whole-canvas fill (e.g. "#fff"); omit for transparent
  // Which seed each cell draws. Defaults to `${baseSeed}-${index}` so changing
  // the base seed reshuffles every shape while keeping the grid deterministic.
  baseSeed?: number | string;
  seedFor?: (row: number, col: number, index: number) => number | string;
  morph?: number;
  t?: number;
  twistT?: number;
} = {}): string {
  const rows = Math.max(1, Math.round(opts.rows ?? 4));
  const cols = Math.max(1, Math.round(opts.cols ?? 4));
  const cellW = opts.cellSize ?? 120;
  const cellH = (cellW * VIEW_H) / VIEW_W;
  const xGap = opts.xGap ?? 16;
  const yGap = opts.yGap ?? 16;
  const pad = opts.padding ?? 0;
  const spec = resolvePaint(opts);
  const N = opts.segments ?? 240;
  const K = spec.kind === "flat" ? 1 : opts.pieces ?? 60; // flat ignores strands
  const white = spec.kind === "white";
  const tintLab = tintFor(spec);
  const grayscale = opts.grayscale ?? false;
  const morph = opts.morph ?? SETTLE_POSE.morph;
  const t = opts.t ?? SETTLE_POSE.t;
  const twistT = opts.twistT ?? SETTLE_POSE.twistT;
  const base = opts.baseSeed ?? 0;
  const seedFor = opts.seedFor ?? ((_r, _c, i) => `${base}-${i}`);

  const totalW = pad * 2 + cols * cellW + (cols - 1) * xGap;
  const totalH = pad * 2 + rows * cellH + (rows - 1) * yGap;

  let cells = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const fr = buildRing(t, twistT, morph, makeHover(seedFor(r, c, i)), N, K, grayscale, white, tintLab);
      const x = pad + c * (cellW + xGap);
      const y = pad + r * (cellH + yGap);
      cells += `<svg x="${f2(x)}" y="${f2(y)}" width="${f2(cellW)}" height="${f2(cellH)}" viewBox="0 0 ${VIEW_W} ${VIEW_H}">${ringMarkup(fr, spec, `c${i}_`)}</svg>`;
    }
  }
  const bg = opts.background
    ? `<rect width="100%" height="100%" fill="${opts.background}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(totalW)}" height="${f2(totalH)}" viewBox="0 0 ${f2(totalW)} ${f2(totalH)}">${bg}${cells}</svg>`;
}

// Settled thumbnail — all the easing math is baked in here so consumers need
// only pass an id and a pixel size. Uses a reduced sample count (N=240, K=60)
// that is fast enough to generate 80+ thumbnails synchronously at page load.
export function exportThumbnailSVG(
  id: number | string,
  size: number,
  grayscale = false,
  segments = 240,
  pieces = 60,
): string {
  const SETTLE_T = 10;
  const SETTLE_TAU = 0.22;
  const progress = 1 - Math.exp(-SETTLE_T / SETTLE_TAU);
  const morph = progress; // TARGET_MORPH = 1
  const twistT = SETTLE_T - SETTLE_TAU * progress;
  return exportSVG({
    id,
    t: SETTLE_T,
    twistT,
    morph,
    segments,
    pieces,
    size,
    grayscale,
  });
}
