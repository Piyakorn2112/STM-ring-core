"use client";

/**
 * HeroGrid — a full-screen field of company rings (same idea as the home grid).
 *
 * Performance plan: the whole grid is STATIC by default — each cell is a cheap
 * pre-rendered thumbnail (a data-URL image, no live work), drawn from a small
 * shared pool so the grid scales to any screen size for ~constant cost.
 *
 * Over time a few cells (≤ MAX_LIVE) are picked to UPDATE: a cell plays a single
 * finite morph from its current shape to a new random one (<MorphRing/>, a
 * dedicated static-transition path — NOT StmRing's animate loop), then settles
 * as the new static thumbnail. Because the morph's endpoints are byte-identical
 * to the thumbnails, it's static → morph → static with no glitch.
 * Honours prefers-reduced-motion (stays fully static).
 */

import { useEffect, useRef, useState } from "react";
import MorphRing from "./MorphRing";
import { exportThumbnailSVG, randomSeed, VIEW_H, VIEW_W } from "./stmRingCore";

const CELL = 140; // cell box (px) — bigger cells ⇒ fewer rings on screen
const RING = 104; // ring size within a cell (px)
const POOL = 120; // distinct static thumbnails, tiled across the grid
const MAX_LIVE = 6; // concurrent morphing rings (safety cap)
const BATCH = 1; // how many start morphing per tick
const ACTIVATE_MS = 900; // how often a new batch starts (more frequent morphs)
const MORPH_MS = 1400; // duration of a single static → morph → static transition
// A touch cheaper than full quality — plenty smooth at this modest size.
// 200/50 keeps a clean 4:1 strand ratio.
const GRID_SEGMENTS = 200;
const GRID_PIECES = 50;

type Cell = { seed: number; url: string };

const dataUrl = (svg: string) =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

const thumb = (seed: number) =>
  dataUrl(exportThumbnailSVG(seed, RING, false, GRID_SEGMENTS, GRID_PIECES));

export default function HeroGrid() {
  const [dims, setDims] = useState({ cols: 0, rows: 0 });
  // index → seedB while a cell is mid-morph.
  const [live, setLive] = useState<Map<number, number>>(new Map());
  // index → new static shape, once a morph has completed.
  const [overrides, setOverrides] = useState<Map<number, Cell>>(new Map());

  // Pool of static thumbnails (seed + image) — generated once.
  const [pool] = useState<Cell[]>(() =>
    Array.from({ length: POOL }, () => {
      const seed = randomSeed();
      return { seed, url: thumb(seed) };
    }),
  );
  // Stable pool index per cell (so a cell's static look never reshuffles).
  const cellPool = useRef<number[]>([]);

  const cellOf = (i: number): Cell => overrides.get(i) ?? pool[cellPool.current[i] ?? 0];

  // Grid dimensions from the viewport; grow cellPool to cover.
  useEffect(() => {
    const measure = () => {
      const cols = Math.ceil(window.innerWidth / CELL) + 1;
      const rows = Math.ceil(window.innerHeight / CELL) + 1;
      const count = cols * rows;
      for (let i = cellPool.current.length; i < count; i++) {
        cellPool.current.push((Math.random() * POOL) | 0);
      }
      setDims({ cols, rows });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const count = dims.cols * dims.rows;

  // Periodically pick idle cells to morph to a fresh shape.
  useEffect(() => {
    if (count === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setLive((prev) => {
        if (prev.size >= MAX_LIVE) return prev;
        const next = new Map(prev);
        let added = 0;
        for (let guard = 0; guard < 40 && added < BATCH && next.size < MAX_LIVE; guard++) {
          const i = (Math.random() * count) | 0;
          if (next.has(i)) continue; // GUARD: never re-pick a cell mid-morph
          next.set(i, randomSeed()); // the shape it will morph TO
          added++;
        }
        return next;
      });
    }, ACTIVATE_MS);
    return () => clearInterval(id);
  }, [count]);

  // Drop in-flight morphs whose cell no longer exists (e.g. a resize shrank the
  // grid) — otherwise their MorphRing unmounts without firing onDone and the
  // stuck entry would permanently occupy the MAX_LIVE budget.
  useEffect(() => {
    setLive((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of next.keys()) {
        if (k >= count) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [count]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background:
          "radial-gradient(120% 120% at 50% 38%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
        display: "grid",
        gridTemplateColumns: `repeat(${dims.cols}, ${CELL}px)`,
        gridAutoRows: `${CELL}px`,
        justifyContent: "center",
        alignContent: "center",
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const seedB = live.get(i);
        return (
          <div key={i} style={{ width: CELL, height: CELL, display: "grid", placeItems: "center" }}>
            {seedB !== undefined ? (
              <MorphRing
                seedA={cellOf(i).seed}
                seedB={seedB}
                size={RING}
                segments={GRID_SEGMENTS}
                pieces={GRID_PIECES}
                durationMs={MORPH_MS}
                onDone={() => {
                  // Settle to the new shape's static thumbnail, then drop the morph.
                  setOverrides((p) => new Map(p).set(i, { seed: seedB, url: thumb(seedB) }));
                  setLive((p) => {
                    const n = new Map(p);
                    n.delete(i);
                    return n;
                  });
                }}
              />
            ) : (
              <div
                aria-hidden="true"
                style={{
                  width: RING,
                  height: (RING * VIEW_H) / VIEW_W,
                  backgroundImage: cellOf(i).url,
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "contain",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
