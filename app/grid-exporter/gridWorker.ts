/**
 * Grid-exporter preview worker — runs the (synchronous, potentially 100 ms+)
 * `exportGridSVG` build OFF the main thread, so dragging sliders never stutters
 * the UI no matter the grid size. It only *imports* the ring core (read-only);
 * it does not modify it. Each request carries a `reqId` so the page can ignore
 * results that a newer request has already superseded.
 */

import { exportGridSVG } from "../components/stmRingCore";

type Req = { reqId: number; key: string; opts: Parameters<typeof exportGridSVG>[0] };

// Minimal typing of the dedicated-worker globals so this compiles under the
// project's DOM lib without pulling in the WebWorker lib.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (e) => {
  const { reqId, key, opts } = e.data;
  ctx.postMessage({ reqId, key, svg: exportGridSVG(opts) });
};

export {};
