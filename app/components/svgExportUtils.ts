/**
 * svgExportUtils — post-processing for the grid exporter's SVG string.
 *
 * Deliberately operates ONLY on the string the engine already produced (it does
 * not touch stmRingCore / the ring's geometry or rendering). It assumes the
 * exact shape `exportGridSVG` emits: one outer `<svg xmlns…>` whose children are
 * cell viewports `<svg x y width height viewBox="0 0 W H">…</svg>`, each holding
 * a `<defs>` of `<linearGradient>`s and stroked `<path>`s.
 */

import { VIEW_W } from "./stmRingCore";

// Round the numbers INSIDE every `d="…"` path to 1 decimal. Path coordinates are
// in the 176×171 ring space rendered at small sizes, so 0.1-unit precision is
// sub-pixel — invisible, but trims the single largest part of the document.
// Crucially this only touches `d` attributes, leaving gradient-stop `offset` /
// `stop-opacity` (which need their full precision) untouched.
function roundPathData(svg: string): string {
  return svg.replace(
    / d="([^"]*)"/g,
    (_m, d: string) => ` d="${d.replace(/-?\d+\.\d+/g, (n) => String(+(+n).toFixed(1)))}"`,
  );
}

// Replace each nested cell `<svg x y width height viewBox>…</svg>` with an
// equivalent `<g transform="translate(x y) scale(s)">…</g>`. Many vector apps
// (Illustrator, some Figma import paths) handle a flat tree of transformed
// groups far more reliably — and cheaply — than nested SVG viewports, and the
// group tag is a little smaller. Because each cell's viewBox origin is 0,0 and
// the cell keeps the ring's aspect ratio, a single uniform scale w/VIEW_W is
// exactly equivalent (and `userSpaceOnUse` gradients ride the same transform).
function nestedSvgToGroups(svg: string): string {
  return svg.replace(
    /<svg x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="[\d.-]+" viewBox="0 0 [^"]*">([\s\S]*?)<\/svg>/g,
    (_m, x: string, y: string, w: string, inner: string) => {
      const s = +(Number(w) / VIEW_W).toFixed(4);
      return `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
    },
  );
}

/**
 * Flatten + shrink a grid SVG for import into graphics apps. Pure string
 * rewrite; output renders identically to the input.
 */
export function flattenGridSvg(svg: string): string {
  return roundPathData(nestedSvgToGroups(svg));
}

export const byteSize = (s: string): number =>
  typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
