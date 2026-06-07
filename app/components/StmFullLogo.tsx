"use client";

/**
 * StmFullLogo — a 1:1 reconstruction of `public/STM logo.svg`, except the static
 * ring is replaced by the live <StmRing/>. The wordmark is the vector text asset
 * (`public/STM text.svg`); the ring is dropped in over the exact spot the brand
 * ring occupies in the logo, in the white opacity-based variant that matches the
 * logo's white-with-alpha ring gradient.
 *
 * By default the ring uses the renderer's default mode: it rests as a clean ring
 * and only twists to life on hover. Pass `animate` to make it cycle seeds.
 *
 * Placement constants were derived by composing the logo's nested affine
 * transforms and mapping the ring outline + text bbox into the 359×107 frame:
 *   • ring  centre  (15.36%, 50.03%),  StmRing size = 0.374 × logo width
 *     (at that size the stroke thickness also matches the logo band)
 *   • text  box     left 34.52%, top 10.09%, width 65.46%, height 80.37%
 */

import StmRing from "./StmRing";

const LOGO_AR = 359 / 107; // brand logo aspect ratio
const RING_SIZE_RATIO = 0.374; // StmRing px size as a fraction of logo width
const RING_CX = "15.36%";
const RING_CY = "50.03%";
const TEXT_BOX = { left: "34.52%", top: "10.09%", width: "65.46%", height: "80.37%" };

export default function StmFullLogo({
  width = 240,
  className,
  animate = false,
}: {
  width?: number;
  className?: string;
  /** Cycle through random seeds (true) vs. rest-until-hover default (false). */
  animate?: boolean;
}) {
  return (
    <div
      className={className}
      style={{ position: "relative", width, height: width / LOGO_AR }}
    >
      {/* wordmark — the text asset, dropped in 1:1 with the logo layout */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/STM%20text.svg"
        alt="Srang Tech Mai"
        style={{ position: "absolute", ...TEXT_BOX }}
      />

      {/* live brand ring (white opacity variant) over the logo's ring slot.
          pointerEvents:auto re-enables hover even inside a non-interactive parent. */}
      <div
        style={{
          position: "absolute",
          left: RING_CX,
          top: RING_CY,
          transform: "translate(-50%,-50%)",
          pointerEvents: "auto",
        }}
      >
        <StmRing size={width * RING_SIZE_RATIO} white animate={animate} />
      </div>
    </div>
  );
}
