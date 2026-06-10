"use client";

/**
 * /scan — the STM "Bloom Code" end to end. Left: generate a code for any id — an
 * enforced 3/4/5/6-fold curved bloom at the heart, a registration circle, and a
 * multilayered field of concentric data dashes. Right: scan one (the generated code,
 * an upload, or the live camera); it decodes with ECC, verifies the centre bloom by
 * shape, then blooms into the live ring for that id.
 *
 * All decoding runs in-browser via the pure `bloomScanner` pipeline; the core engine
 * is untouched.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StmRing from "../components/StmRing";
import { encodeSymbols } from "../components/ringCodeCore";
import {
  accentFor,
  bloomCentreSVG,
  bloomSeed,
  encodeBloomSVG,
  MAX_PAYLOAD,
} from "../components/bloomCodeCore";
import {
  centreIoU,
  CENTRE_INK_THRESH,
  CENTRE_IOU_MIN,
  closeMask,
  decodeBloomData,
  extractCentre,
  inkMask,
} from "../components/bloomScanner";

const DECODE_PX = 480; // working resolution for the decoder
const CENTRE_PX = 110; // centre-patch resolution for the shape check
const dataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

type Report = {
  payload: number;
  confidence: number;
  iou: number;
  verified: boolean;
  fold: number;
};

// Draw any image source into a white DECODE_PX canvas and return its RGBA pixels.
function pixelsFrom(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = DECODE_PX;
  canvas.height = DECODE_PX;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, DECODE_PX, DECODE_PX);
  const s = Math.min(DECODE_PX / w, DECODE_PX / h);
  const dw = w * s, dh = h * s;
  ctx.drawImage(src, (DECODE_PX - dw) / 2, (DECODE_PX - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, DECODE_PX, DECODE_PX).data;
}

// Rasterise an SVG string to a binary silhouette mask (for the centre reference).
function svgToMask(svg: string, sz: number, thresh: number): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = sz;
      c.height = sz;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, sz, sz);
      ctx.drawImage(im, 0, 0, sz, sz);
      const d = ctx.getImageData(0, 0, sz, sz).data;
      const m = new Uint8Array(sz * sz);
      for (let i = 0; i < sz * sz; i++) m[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 < thresh ? 1 : 0;
      resolve(m);
    };
    im.onerror = () => resolve(new Uint8Array(sz * sz));
    im.src = dataUrl(svg);
  });
}

export default function ScanPage() {
  const [raw, setRaw] = useState("12345");
  const [grayscaleFlower, setGrayscaleFlower] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [status, setStatus] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const payload = Math.max(0, Math.min(MAX_PAYLOAD, Math.floor(Number(raw) || 0)));
  const svg = useMemo(
    () => encodeBloomSVG(payload, { size: 360, background: "#ffffff", grayscaleFlower }),
    [payload, grayscaleFlower],
  );
  const genFold = useMemo(() => bloomSeed(payload).fold, [payload]);

  // Decode pixels: ECC frame + centre shape verify.
  const decodePixels = useCallback(async (data: Uint8ClampedArray) => {
    const scan = decodeBloomData(data, DECODE_PX, DECODE_PX, encodeSymbols);
    if (scan.payload < 0 || !scan.circle) {
      setReport(null);
      setStatus("No code found");
      return;
    }
    // Silhouette masks (lenient threshold) + morphological close so the centre check
    // is robust to charge-holes, sub-pixel drift, and renderer differences.
    const mask = inkMask(data, DECODE_PX, DECODE_PX, CENTRE_INK_THRESH);
    const cap = closeMask(extractCentre(mask, scan.circle, scan.originAngle, CENTRE_PX), CENTRE_PX, 2);
    const refRaw = await svgToMask(bloomCentreSVG(scan.payload, CENTRE_PX, true), CENTRE_PX, CENTRE_INK_THRESH);
    const ref = closeMask(refRaw, CENTRE_PX, 2);
    const iou = centreIoU(cap, ref);
    const verified = scan.eccOk && iou >= CENTRE_IOU_MIN;
    setReport({ payload: scan.payload, confidence: scan.confidence, iou, verified, fold: bloomSeed(scan.payload).fold });
    if (verified) setReveal(scan.payload);
    setStatus("");
  }, []);

  const decodeImage = useCallback(
    (im: HTMLImageElement) => {
      const px = pixelsFrom(im, im.naturalWidth, im.naturalHeight);
      if (px) void decodePixels(px);
    },
    [decodePixels],
  );

  const scanGenerated = useCallback(() => {
    const im = new Image();
    im.onload = () => decodeImage(im);
    im.src = dataUrl(encodeBloomSVG(payload, { size: 480, background: "#ffffff", grayscaleFlower }));
  }, [payload, grayscaleFlower, decodeImage]);

  const onUpload = useCallback(
    (file: File) => {
      const im = new Image();
      im.onload = () => decodeImage(im);
      im.src = URL.createObjectURL(file);
    },
    [decodeImage],
  );

  const stopCam = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }, []);

  const startCam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();
      setCamOn(true);
      setStatus("Point at a code…");
      let busy = false;
      const tick = () => {
        if (v.videoWidth && !busy) {
          const px = pixelsFrom(v, v.videoWidth, v.videoHeight);
          if (px) {
            busy = true;
            void decodePixels(px).finally(() => (busy = false));
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setStatus("Camera unavailable — try upload or the generated code.");
    }
  }, [decodePixels]);

  useEffect(() => () => stopCam(), [stopCam]);

  const accent = reveal !== null ? accentFor(reveal) : "#5827E0";

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        padding: "40px 24px 80px",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        background: "radial-gradient(120% 120% at 50% 30%, #fbfbfa 0%, #ededeb 55%, #e2e2df 100%)",
      }}
    >
      <div style={{ position: "fixed", top: 20, left: 20, zIndex: 5 }}>
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: "#5827E0" }}>
          ← Back
        </Link>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 26 }}>
        <header style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 25, fontWeight: 700, color: "#18181b", margin: 0 }}>Bloom Code</h1>
          <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.6, color: "#71717a", maxWidth: 580, marginInline: "auto" }}>
            A 3/4/5/6-fold curved bloom at the heart, a registration circle, and a
            multilayered ring of concentric data dashes. Rotation-safe, obscure-safe, and
            the centre bloom is verified by shape — then it blooms into the live ring.
          </p>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
          {/* LEFT — generate */}
          <section style={{ display: "grid", gap: 14, justifyItems: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#a1a1aa", textTransform: "uppercase" }}>
              Generate · {genFold}-fold
            </div>
            <div style={{ width: 300, height: 300, background: "#fff", borderRadius: 16, boxShadow: "0 10px 40px rgba(0,0,0,0.08)", display: "grid", placeItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl(svg)} alt="" style={{ width: "94%", height: "94%", objectFit: "contain" }} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", width: 300 }}>
              <input
                type="number"
                min={0}
                max={MAX_PAYLOAD}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                aria-label="Payload id"
                style={{ width: 96, padding: "9px 12px", fontSize: 14, fontFamily: "var(--font-geist-mono), monospace", color: "#18181b", background: "#fff", border: "1px solid #d4d4d8", borderRadius: 10 }}
              />
              <input type="range" min={0} max={MAX_PAYLOAD} value={payload} onChange={(e) => setRaw(e.target.value)} style={{ flex: 1, accentColor: "#111" }} />
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={() => setRaw(String(Math.floor(Math.random() * (MAX_PAYLOAD + 1))))} style={btnGhost}>⟳ Random</button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#52525b", cursor: "pointer" }}>
                <input type="checkbox" checked={grayscaleFlower} onChange={(e) => setGrayscaleFlower(e.target.checked)} /> Grey bloom
              </label>
            </div>
          </section>

          {/* RIGHT — scan */}
          <section style={{ display: "grid", gap: 14, justifyItems: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#a1a1aa", textTransform: "uppercase" }}>
              Scan
            </div>
            <div style={{ position: "relative", width: 300, height: 300, background: "#0b0b0c", borderRadius: 16, overflow: "hidden", display: "grid", placeItems: "center" }}>
              <video ref={videoRef} playsInline muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: camOn ? 1 : 0 }} />
              {reveal !== null ? (
                <div style={{ display: "grid", placeItems: "center", gap: 10, zIndex: 2 }}>
                  <StmRing size={210} forceSeed={`bloomcode:${reveal}:${bloomSeed(reveal).k}`} />
                  <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontWeight: 700, fontSize: 20, color: accent }}>#{reveal}</div>
                </div>
              ) : (
                !camOn && <div style={{ color: "#71717a", fontSize: 13, zIndex: 2 }}>{status || "Scan a code to reveal"}</div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={scanGenerated} style={btnDark}>Scan the code →</button>
              {!camOn ? (
                <button onClick={startCam} style={btnGhost}>📷 Camera</button>
              ) : (
                <button onClick={stopCam} style={btnGhost}>■ Stop</button>
              )}
              <label style={{ ...btnGhost, cursor: "pointer" }}>
                Upload
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
              </label>
            </div>

            {report && (
              <div style={{ display: "grid", gap: 4, justifyItems: "center", fontSize: 13 }}>
                <div style={{ color: report.verified ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                  {report.verified ? `✓ verified · id ${report.payload}` : `✗ not verified (id ${report.payload})`}
                </div>
                <div style={{ color: "#a1a1aa", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11.5 }}>
                  ECC {(report.confidence * 100).toFixed(0)}% · centre IoU {(report.iou * 100).toFixed(0)}% · {report.fold}-fold
                </div>
              </div>
            )}
          </section>
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "#a1a1aa", margin: 0 }}>
          id 0–{MAX_PAYLOAD.toLocaleString()} · registration-circle frame · Hamming ECC + interleaved repeat · centre shape-verified
        </p>
      </div>
    </main>
  );
}

const btnBase: React.CSSProperties = { padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer" };
const btnDark: React.CSSProperties = { ...btnBase, color: "#fff", background: "#111" };
const btnGhost: React.CSSProperties = { ...btnBase, color: "#3f3f46", background: "#f4f4f5", border: "1px solid #d4d4d8" };
