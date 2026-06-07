"use client";

import { useState } from "react";
import {
  exportThumbnailSVG,
  randomSeed,
  VIEW_H,
  VIEW_W,
} from "./stmRingCore";

const GRID_COLS = 10;
const GRID_ROWS = 20;
const RING_COUNT = GRID_COLS * GRID_ROWS;
const CELL_SIZE = 56;
const RING_SIZE = 40;

const svgToDataUrl = (svg: string) =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

function generateDistinctSeeds(count: number): number[] {
  const seen = new Set<number>();
  while (seen.size < count) seen.add(randomSeed());
  return Array.from(seen);
}

export default function RandomRingGrid() {
  const [seeds] = useState(() => generateDistinctSeeds(RING_COUNT));
  const [rings] = useState(() =>
    seeds.map((seed) =>
      svgToDataUrl(exportThumbnailSVG(seed, RING_SIZE)),
    ),
  );

  return (
    <section
      aria-label="Randomized ring grid"
      style={{
        width: "100%",
        maxWidth: 920,
        display: "grid",
        gap: 18,
        justifyItems: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          color: "#555",
          paddingLeft: "0.24em",
        }}
      >
        {RING_COUNT} random seeds
      </div>

      <div style={{ width: "100%", overflowX: "auto", paddingBottom: 6 }}>
        <div
          style={{
            width: "max-content",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_COLS}, ${CELL_SIZE}px)`,
            gridTemplateRows: `repeat(${GRID_ROWS}, ${CELL_SIZE}px)`,
            gap: 10,
            padding: 16,
            borderRadius: 24,
            background: "rgba(255, 255, 255, 0.58)",
            boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.05)",
          }}
        >
          {Array.from({ length: RING_COUNT }, (_, index) => {
            return (
              <div
                key={index}
                style={{
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: RING_SIZE,
                    height: (RING_SIZE * VIEW_H) / VIEW_W,
                    backgroundImage: rings[index],
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    backgroundSize: "contain",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}