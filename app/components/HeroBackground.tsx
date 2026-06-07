"use client";

/**
 * HeroBackground — the cycling hero field. Every CYCLE_MS the background fades to
 * the next of the 3 company colours and the giant background ring swaps to a new
 * shape (driven by the same tick). The ring sits inside the coloured layer so its
 * multiply blend ("linear burn" stand-in) burns into whichever colour is current.
 */

import { useEffect, useState } from "react";
import HeroRing from "./HeroRing";
import { PALETTE } from "./stmRingCore";

const CYCLE_MS = 16000; // 16s per company colour / shape

export default function HeroBackground() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  const color = PALETTE[tick % PALETTE.length];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: color,
        transition: "background-color 1.6s ease",
      }}
    >
      <HeroRing shapeKey={tick} />
    </div>
  );
}
