@AGENTS.md

# STM Ring — system handoff (read this first)

This repo is a **sandbox** for exploring and **archiving versions** of the "Srang
Tech Mai" generative ring logo. The owner experiments with variants and keeps
old ones around to reuse later. Two hard rules follow from that:

1. **Never degrade existing behaviour.** New capabilities are added as *optional*
   params/props that default to a **no-op**, so every existing call site renders
   byte-identical. (Examples: `white`, `segments`/`pieces`/`fps` on `StmRing`;
   `segments`/`pieces` on `exportThumbnailSVG`.)
2. **Don't delete/replace archived versions.** When asked for a "new" page, add a
   new route + nav button; keep the old one.

Stack: **Next.js 16 (app router, Turbopack)**. `AGENTS.md` warns it's a modified
Next — check `node_modules/next/dist/docs/` before writing routing/config code.
Everything is pure SVG + `requestAnimationFrame`; no animation libs.

## The engine — `app/components/stmRingCore.ts`
Framework-agnostic, heavily commented. Read the file; the gist:

- A ring's **centre-line** is a closed Fourier/epicycle sum: base circle (k=1) +
  epicycles `k1` (dominant), `k2` (overtone), `k3` (low lobe). It's resampled by
  arc length, corner-rounded, then emitted as ordered Catmull-Rom "strands" that
  paint in order to give real over/under weave. Colour is per-vertex OKLab; a lit
  "charge" arc drifts around the loop.
- Fully **deterministic per id** (`hashId` → `mulberry32`). `makeHover(id)` builds
  all parameters; same id → same ring.
- Key API: `buildRing(t,twistT,morph,hover,N,K,grayscale,white)`,
  `buildRingMorph(...,hA,hB,blend,...)` (blends two centre-lines point-for-point),
  `exportSVG(opts)`, `exportThumbnailSVG(id,size,grayscale?,segments?,pieces?)`
  (settled static thumbnail), `makeHover`, `randomSeed`, `PALETTE` (the 3 brand
  colours), geometry consts (`VIEW_W/H`, `CX/CY`, `R_MID`, `STROKE`, `GRAD_*`),
  `WHITE_BASE_OPACITY`.

### Coherence rules — DO NOT change these (they're load-bearing)
- Golden law: `a1 = φ·(…)/k1mag` so `|k1·a1| ≈ φ` (clean self-crossing loop).
- Cascade caps: `a2 = min(a1/φ², 0.42/k2mag)`; `a3 = a2/φ²`.
- Max twist: `k1mag ∈ {2,3,4,5}`.
- In-frame shrink: `cShrink = min(0.9, a1+a2+a3)`.
- The idle **rotation/breathe/charge-drift is intentional ("feels alive")** — keep it.

### Hard-won learnings (don't relearn these)
- **k3 must stay LOW (`2..5`).** Curvature ∝ `k²·A`, and the spline's C²-break
  ("bent-then-straightened" kink) ∝ `k³·A`; since `a3` doesn't shrink with k3,
  high k3 blows up quadratically. *Bigger k3 is strictly worse, not safer.*
  Verified by replaying the RNG over 10⁴–10⁵ seeds in throwaway `/tmp` node
  scripts (the right way to investigate curve/perf questions here — measure, don't
  eyeball; uses the `diagnose` skill mindset).
- **Symmetry family:** ~38% of seeds lock to exact n-fold symmetry by drawing
  every harmonic from `k ≡ 1 (mod n)` (`symAllowed`, `SYM_ORDERS` weighted toward
  low orders so 6-fold is rare). Symmetry survives phase drift/spin/breathe.
- **White variant** is opacity-based (white wire, alpha gradient) to match the
  brand logo's ring; not a colour change.
- `mix-blend-mode: multiply` is the web stand-in for Photoshop "Linear Burn"
  (no CSS `linear-burn` exists).
- A 3D-flip / extra in-plane-rotation experiment was tried and **reverted** — do
  not reintroduce unless asked.

## Components (`app/components/`)
- `StmRing.tsx` — live React renderer over the engine. Modes: rest-until-hover
  (default), `forceSeed` (settles to a seed, glides between seeds via a one-shot
  morph), `animate` (continuous seed-cycling morph with hold + `backOut(smoothstep)`
  transition). Props `grayscale`, `white`, `segments`/`pieces` (cheaper), `fps`
  (cap). Per-frame it rewrites paths + gradient stops via `setAttribute`.
- `MorphRing.tsx` — **standalone** finite morph A→B (used only by the grid hero).
  Shares none of `StmRing`'s animate machinery; pulls only `buildRingMorph` at a
  fixed **settled pose** so blend 0 / 1 are byte-identical to the seed-A / seed-B
  thumbnails ⇒ seamless `static → morph → static`. Same `backOut(smoothstep)`
  curve as `StmRing`; runs to full settle before `onDone`.
- `StmFullLogo.tsx` — reconstructs `public/STM logo.svg` 1:1: the `STM text.svg`
  wordmark + a positioned **white** live `StmRing` over the ring slot (placement
  constants derived by composing the SVG's nested transforms).
- `HeroRing.tsx` + `HeroBackground.tsx` — the original `/hero`: a giant grayscale
  ring multiply-blended over a background that cycles the 3 brand colours every
  16s (and swaps the ring's shape on the same tick).
- `HeroGrid.tsx` — `/hero-grid`: full-screen field, static thumbnails by default;
  a few cells (`MAX_LIVE`) periodically morph via `MorphRing` then settle. Has a
  guard against re-picking a mid-morph cell and a prune for orphaned live cells on
  resize. Tunables at top (CELL/RING/POOL/MAX_LIVE/BATCH/ACTIVATE_MS/MORPH_MS).
- `Showcase.tsx`, `RandomRingGrid.tsx` — the home page pieces.

## Routes (`app/`)
- `/` — `Showcase` (seed box, grayscale + animate toggles, download SVG) +
  `RandomRingGrid`; fixed top-right nav: **Hero / Grid / Letters**.
- `/hero` — original animated hero (HeroBackground + StmFullLogo).
- `/hero-grid` — the ring-field hero (HeroGrid).
- `/letters` — split screen: text field left, grid right; each typed character →
  its own deterministic static thumbnail (cached per char, whitespace skipped).
- `/compare` — pre-existing comparison page (untouched here).

## Current state / where we left off
Polishing `/hero-grid`: the static-transition `MorphRing` path is in place and
glitch-free; tuning cadence/feel (cell size, morph frequency, `MORPH_MS`). No
open bugs known. **Run `npx tsc --noEmit`** to confirm clean (recent checks were
interrupted but edits were consistent).

## Suggested skills
- `mattpocock-skills:diagnose` — for any curve-quality or perf question; pair with
  throwaway `/tmp` RNG-replay scripts to measure before changing the engine.
- `andrej-karpathy-skills:karpathy-guidelines` — keep changes surgical / no-op by
  default, matching rule #1 above.
- `run` / `verify` — to launch the app and eyeball a change (dev server is the
  user's own on :3000; don't curl it without asking).
