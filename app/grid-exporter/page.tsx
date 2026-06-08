"use client";

/**
 * /grid-exporter — compose a grid of deterministic STM rings and export the
 * whole thing as ONE self-contained SVG.
 *
 * PERFORMANCE (all at this layer — the ring core is untouched):
 *  - The heavy `exportGridSVG` build runs in a Web Worker (`gridWorker.ts`), so
 *    it never blocks the main thread: the UI stays interactive and the preview
 *    swaps in when ready, with the previous frame held meanwhile (no flashing).
 *    If a worker can't be created it falls back to a deferred main-thread build.
 *  - Preview quality is scaled to the VIEWPORT: segment/piece counts track the
 *    actual on-screen pixel size of one ring (cell size × fit-scale × DPR), so a
 *    grid shrunk to fit is built at a fraction of the cost. The DOWNLOAD always
 *    uses the user's full settings.
 *  - `useDeferredValue` coalesces rapid edits before they reach the worker; the
 *    preview <img> uses a Blob object URL (no multi-MB encode on the main thread).
 */

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { type ColorMode, exportGridSVG, PALETTE, randomSeed, VIEW_H, VIEW_W } from "../components/stmRingCore";
import { byteSize, flattenGridSvg, formatBytes } from "../components/svgExportUtils";

type Config = {
  rows: number;
  cols: number;
  cellSize: number;
  xGap: number;
  yGap: number;
  padding: number;
  segments: number;
  pieces: number;
  colorMode: ColorMode;
  tint: string;
  grayscale: boolean;
  transparent: boolean;
  bg: string;
  seed: string;
};

const DEFAULTS: Config = {
  rows: 4,
  cols: 6,
  cellSize: 120,
  xGap: 16,
  yGap: 16,
  padding: 24,
  segments: 240,
  pieces: 60,
  colorMode: "luminosity",
  tint: PALETTE[0],
  grayscale: false,
  transparent: false,
  bg: "#fbfbfa",
  seed: "0",
};

// The 3 brand colours offered as one-tap tints, plus mono extremes.
const BRAND_TINTS = PALETTE; // ["#5057FF", "#3B86FF", "#FB5607"]
const MONO_TINTS = ["#000000", "#ffffff"];

// Viewport-scaled preview quality. The detail a ring needs is bounded by how
// many pixels it actually occupies on screen — there's no point sampling a
// 700-point centre-line for a ring drawn 40 px wide. Given the displayed pixel
// width of one ring, pick segment/piece counts proportional to it (capped by the
// user's own settings). Download ignores this and uses the exact settings.
const SEG_PER_PX = 1.4; // centre-line samples per displayed pixel of ring width
const SEG_FLOOR = 60;
const PIECE_RATIO = 0.25; // strands ≈ N/4 (matches the engine's clean 4:1 ratio)
const PIECE_FLOOR = 20;

function previewQuality(ringPx: number, maxSeg: number, maxPiece: number) {
  const segments = Math.max(SEG_FLOOR, Math.min(maxSeg, Math.round(ringPx * SEG_PER_PX)));
  const pieces = Math.max(PIECE_FLOOR, Math.min(maxPiece, Math.round(segments * PIECE_RATIO)));
  return { segments, pieces };
}

function buildOptions(cfg: Config, segments: number, pieces: number) {
  return {
    rows: cfg.rows,
    cols: cfg.cols,
    cellSize: cfg.cellSize,
    xGap: cfg.xGap,
    yGap: cfg.yGap,
    padding: cfg.padding,
    segments,
    pieces,
    colorMode: cfg.colorMode,
    tint: cfg.tint,
    grayscale: cfg.grayscale, // only applies in luminosity mode
    background: cfg.transparent ? undefined : cfg.bg,
    baseSeed: cfg.seed.trim() || "0",
  };
}

// A numeric knob with a slider + a synced text input (both edit the same value).
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <label style={{ display: "grid", gap: 7 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 12.5,
          fontWeight: 600,
          color: "#3f3f46",
        }}
      >
        <span>{label}</span>
        <span style={{ color: "#a1a1aa", fontWeight: 500, fontSize: 11 }}>
          {min}–{max}
          {suffix ? ` ${suffix}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          style={{ flex: 1, accentColor: "#5827E0" }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = e.target.value === "" ? min : Number(e.target.value);
            if (!Number.isNaN(v)) onChange(clamp(v));
          }}
          style={{
            width: 64,
            padding: "6px 8px",
            fontSize: 12.5,
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            color: "#18181b",
            background: "#fff",
            border: "1px solid #d4d4d8",
            borderRadius: 8,
            outline: "none",
          }}
        />
      </div>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
        fontWeight: 600,
        color: "#3f3f46",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: options.length >= 4 ? "1fr 1fr" : `repeat(${options.length}, 1fr)`,
        gap: 4,
        background: "#f4f4f5",
        padding: 4,
        borderRadius: 10,
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "7px 0",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            color: value === o.value ? "#fff" : "#52525b",
            background: value === o.value ? "#111" : "transparent",
            transition: "background 0.12s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TintPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const norm = value.toLowerCase();
  const swatch = (hex: string) => {
    const selected = norm === hex.toLowerCase();
    return (
      <button
        key={hex}
        onClick={() => onChange(hex)}
        title={hex}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          cursor: "pointer",
          background: hex,
          border: selected ? "2px solid #111" : "1px solid #d4d4d8",
          boxShadow: selected ? "0 0 0 2px #fff inset" : "none",
        }}
      />
    );
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3f3f46" }}>Tint</span>
      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        {BRAND_TINTS.map(swatch)}
        <span style={{ width: 1, height: 22, background: "#e4e4e7", margin: "0 2px" }} />
        {MONO_TINTS.map(swatch)}
        <label
          title="Custom colour"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: "1px solid #d4d4d8",
            overflow: "hidden",
            cursor: "pointer",
            position: "relative",
            display: "grid",
            placeItems: "center",
            background:
              "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
          }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
          />
        </label>
      </div>
    </div>
  );
}

export default function GridExporterPage() {
  // One state object so its identity is stable between unrelated renders, which
  // is what lets useDeferredValue coalesce heavy rebuilds.
  const [cfg, setCfg] = useState<Config>(DEFAULTS);
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));

  const [flatten, setFlatten] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);

  // The preview tracks a DEFERRED copy of the config: dragging a slider updates
  // `cfg` instantly (responsive UI) while the build follows behind / off-thread.
  const previewCfg = useDeferredValue(cfg);

  // --- viewport measurement: how big is the preview pane, in CSS px? ---------
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Round to 24px steps so ordinary resizes don't churn the quality/build.
      setPane({ w: Math.round(width / 24) * 24, h: Math.round(height / 24) * 24 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Displayed pixel width of ONE ring = cell size × (scale that fits the grid in
  // the pane) × device pixel ratio (capped). This is the "limit to the viewport"
  // lever: shrink the grid to fit and every ring is built at its on-screen size.
  const previewOpts = useMemo(() => {
    const naturalW = previewCfg.padding * 2 + previewCfg.cols * previewCfg.cellSize + (previewCfg.cols - 1) * previewCfg.xGap;
    const cellH = (previewCfg.cellSize * VIEW_H) / VIEW_W;
    const naturalH = previewCfg.padding * 2 + previewCfg.rows * cellH + (previewCfg.rows - 1) * previewCfg.yGap;
    const availW = Math.max(1, pane.w - 72); // pane padding (36×2)
    const availH = Math.max(1, pane.h - 96); // padding + caption
    const fit = pane.w > 0 ? Math.min(availW / naturalW, availH / naturalH, 1) : 1;
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const ringPx = previewCfg.cellSize * fit * dpr;
    const { segments, pieces } = previewQuality(ringPx, previewCfg.segments, previewCfg.pieces);
    return buildOptions(previewCfg, segments, pieces);
  }, [previewCfg, pane]);
  const previewCapped =
    previewOpts.segments < previewCfg.segments || previewOpts.pieces < previewCfg.pieces;

  // The identity of the build we WANT on screen; the build we HAVE is `shownKey`.
  // `pending` is derived from the two, so setState never runs in an effect body.
  const buildKey = useMemo(() => JSON.stringify(previewOpts), [previewOpts]);

  // --- preview pipeline: build (worker if possible) → Blob URL → <img> -------
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef<string>(""); // current object URL, for revocation
  const reqIdRef = useRef(0); // monotonic request id
  const shownRef = useRef(0); // highest reqId already shown (drop stale)
  const [previewUrl, setPreviewUrl] = useState("");
  const [shownKey, setShownKey] = useState("");

  // Swap in a freshly-built SVG, revoking the previous URL. Stable identity so
  // it can sit in effect deps without re-running them.
  const showSvg = useCallback((svg: string, key: string) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPreviewUrl(url);
    setShownKey(key);
  }, []);

  // Spin up the worker once. Falls back to main-thread builds if unavailable.
  useEffect(() => {
    try {
      const w = new Worker(new URL("./gridWorker.ts", import.meta.url));
      w.onmessage = (e: MessageEvent<{ reqId: number; key: string; svg: string }>) => {
        const { reqId, key, svg } = e.data;
        if (reqId < shownRef.current) return; // a newer build already won
        shownRef.current = reqId;
        showSvg(svg, key);
      };
      w.onerror = () => { workerRef.current = null; }; // fall back on runtime error
      workerRef.current = w;
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [showSvg]);

  // Dispatch a build whenever the wanted build (config × viewport quality) changes.
  // setState only happens later in the worker callback / timeout — never in this
  // effect body — so the previous frame stays on screen until the new one is ready
  // (no blanking; no main-thread stutter when a worker is present).
  useEffect(() => {
    if (pane.w === 0) return; // wait for first measure
    const reqId = ++reqIdRef.current;
    const w = workerRef.current;
    if (w) {
      w.postMessage({ reqId, key: buildKey, opts: previewOpts });
      return;
    }
    const t = setTimeout(() => {
      if (reqId < shownRef.current) return;
      shownRef.current = reqId;
      showSvg(exportGridSVG(previewOpts), buildKey);
    }, 0);
    return () => clearTimeout(t);
  }, [previewOpts, buildKey, pane.w, showSvg]);

  const isStale = buildKey !== shownKey;
  const ringCount = cfg.rows * cfg.cols;

  const download = () => {
    // Full-resolution build at the user's exact settings (one-off; fine to block).
    let svg = exportGridSVG(buildOptions(cfg, cfg.segments, cfg.pieces));
    const rawSize = byteSize(svg);
    if (flatten) svg = flattenGridSvg(svg);
    const finalSize = byteSize(svg);

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const tag = flatten ? "-flat" : "";
    a.href = url;
    a.download = `stm-grid-${cfg.cols}x${cfg.rows}-${(cfg.seed.trim() || "0").replace(/[^a-z0-9_-]+/gi, "_")}${tag}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setExportInfo(
      flatten
        ? `Exported ${formatBytes(finalSize)} (flattened from ${formatBytes(rawSize)})`
        : `Exported ${formatBytes(finalSize)}`,
    );
  };

  const sectionTitle = (t: string) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#a1a1aa",
        marginTop: 4,
      }}
    >
      {t}
    </div>
  );

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      }}
    >
      {/* LEFT — controls */}
      <div
        style={{
          width: 360,
          minWidth: 320,
          height: "100%",
          overflow: "auto",
          padding: "28px 26px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          background: "#fff",
          borderRight: "1px solid #e6e6e3",
        }}
      >
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: "#5827E0" }}>
          ← Back
        </Link>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", color: "#18181b" }}>
            Grid exporter
          </h1>
          <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.55, color: "#71717a" }}>
            Tile deterministic rings into a grid and export it all as one SVG. The
            preview updates live; the download is full-resolution.
          </p>
        </div>

        {sectionTitle("Grid")}
        <NumberField label="Columns" value={cfg.cols} onChange={(v) => set("cols", v)} min={1} max={16} />
        <NumberField label="Rows" value={cfg.rows} onChange={(v) => set("rows", v)} min={1} max={16} />
        <NumberField label="Ring size" value={cfg.cellSize} onChange={(v) => set("cellSize", v)} min={32} max={320} suffix="px" />
        <NumberField label="X gap" value={cfg.xGap} onChange={(v) => set("xGap", v)} min={0} max={160} suffix="px" />
        <NumberField label="Y gap" value={cfg.yGap} onChange={(v) => set("yGap", v)} min={0} max={160} suffix="px" />
        <NumberField label="Padding" value={cfg.padding} onChange={(v) => set("padding", v)} min={0} max={160} suffix="px" />

        {sectionTitle("Ring detail")}
        <NumberField label="Segments (N)" value={cfg.segments} onChange={(v) => set("segments", v)} min={60} max={700} step={10} />
        <NumberField label="Pieces (K)" value={cfg.pieces} onChange={(v) => set("pieces", v)} min={20} max={360} step={5} />

        {sectionTitle("Style")}
        <Segmented<ColorMode>
          value={cfg.colorMode}
          onChange={(v) => set("colorMode", v)}
          options={[
            { value: "luminosity", label: "Luminosity" },
            { value: "transparency", label: "Transparency" },
            { value: "contrast", label: "Contrast" },
            { value: "flat", label: "Flat" },
          ]}
        />
        <p style={{ margin: "-8px 0 0", fontSize: 11.5, lineHeight: 1.5, color: "#a1a1aa" }}>
          {cfg.colorMode === "luminosity"
            ? "Full multi-colour charge over the dark base — the original look."
            : cfg.colorMode === "transparency"
              ? "One tint everywhere, depth carried by opacity — a clearly-visible single-colour path."
              : cfg.colorMode === "contrast"
                ? "Like transparency, but the rest of the ring is far fainter — the charged arc reads as a sharp solid against an almost-transparent remainder."
                : "One solid flat colour — no gradients or fade. Smallest export."}
        </p>
        {cfg.colorMode === "luminosity" ? (
          <Toggle label="Grayscale" checked={cfg.grayscale} onChange={(v) => set("grayscale", v)} />
        ) : (
          <TintPicker value={cfg.tint} onChange={(v) => set("tint", v)} />
        )}
        <Toggle label="Transparent bg" checked={cfg.transparent} onChange={(v) => set("transparent", v)} />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            fontSize: 12.5,
            fontWeight: 600,
            color: "#3f3f46",
            opacity: cfg.transparent ? 0.4 : 1,
          }}
        >
          Background
          <input
            type="color"
            value={cfg.bg}
            disabled={cfg.transparent}
            onChange={(e) => set("bg", e.target.value)}
            style={{ width: 44, height: 28, border: "1px solid #d4d4d8", borderRadius: 8, background: "#fff" }}
          />
        </label>

        {sectionTitle("Seed")}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={cfg.seed}
            onChange={(e) => set("seed", e.target.value)}
            placeholder="base seed"
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              padding: "9px 12px",
              fontSize: 12.5,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              color: "#18181b",
              background: "#fff",
              border: "1px solid #d4d4d8",
              borderRadius: 9,
              outline: "none",
            }}
          />
          <button
            onClick={() => set("seed", String(randomSeed()))}
            title="Random seed"
            style={{
              padding: "9px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#3f3f46",
              background: "#f4f4f5",
              border: "1px solid #d4d4d8",
              borderRadius: 9,
              cursor: "pointer",
            }}
          >
            ⟳
          </button>
        </div>

        {sectionTitle("Export")}
        <Toggle label="Optimized / flattened SVG" checked={flatten} onChange={setFlatten} />
        <p style={{ margin: "-8px 0 0", fontSize: 11.5, lineHeight: 1.5, color: "#a1a1aa" }}>
          Flattens cell viewports into transformed groups and trims path precision
          — smaller files that import faster into Illustrator / Figma.
        </p>

        <button
          onClick={download}
          style={{
            marginTop: 6,
            padding: "12px 18px",
            fontSize: 13.5,
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "#111",
            border: "none",
            borderRadius: 11,
            cursor: "pointer",
          }}
        >
          Download SVG ↓
        </button>
        {exportInfo && (
          <div style={{ fontSize: 11.5, color: "#16a34a", fontFamily: "var(--font-geist-mono), monospace" }}>
            {exportInfo}
          </div>
        )}
      </div>

      {/* RIGHT — live preview (the exact export, at viewport-scaled quality) */}
      <div
        ref={paneRef}
        style={{
          flex: 1,
          height: "100%",
          overflow: "auto",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 36,
          background:
            "radial-gradient(120% 120% at 50% 38%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
        }}
      >
        {isStale && (
          <div
            style={{
              position: "absolute",
              top: 18,
              right: 18,
              padding: "5px 11px",
              fontSize: 11,
              fontWeight: 600,
              color: "#fff",
              background: "rgba(17,17,17,0.78)",
              borderRadius: 999,
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            rendering…
          </div>
        )}
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Ring grid preview"
            style={{
              maxWidth: "100%",
              maxHeight: "calc(100% - 36px)",
              objectFit: "contain",
              opacity: isStale ? 0.55 : 1,
              transition: "opacity 0.15s",
              background: cfg.transparent
                ? "repeating-conic-gradient(#e9e9e6 0% 25%, #f6f6f4 0% 50%) 50% / 22px 22px"
                : "transparent",
              boxShadow: "0 10px 40px rgba(0,0,0,0.10)",
              borderRadius: 4,
            }}
          />
        )}
        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "#71717a",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {cfg.cols}×{cfg.rows} · {ringCount} ring{ringCount === 1 ? "" : "s"}
          {previewCapped ? " · preview detail reduced (export is full-res)" : ""}
        </div>
      </div>
    </main>
  );
}
