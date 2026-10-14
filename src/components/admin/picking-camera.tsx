"use client";

import { useEffect, useRef, useState } from "react";
import { ScanPress } from "@/lib/admin/scan-press";

/** Keep the camera warm; a press accepts at most one code, never inventory. */
export function PickingCamera({ onCode, onClose, enabled = true }: {
  onCode: (code: string) => void; onClose: () => void; enabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const press = useRef(new ScanPress());
  const callback = useRef(onCode);
  const allowed = useRef(enabled);
  const [ready, setReady] = useState(false);
  const [holding, setHolding] = useState(false);
  const [status, setStatus] = useState("Pokretanje kamere…");
  const [error, setError] = useState("");
  useEffect(() => { callback.current = onCode; }, [onCode]);
  useEffect(() => {
    allowed.current = enabled;
    if (!enabled) { press.current.release(); }
  }, [enabled]);
  useEffect(() => {
    const trigger = press.current;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { press.current.release(); setHolding(false); };
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    const start = async () => {
      try {
        // Load the decoder while the camera starts rather than delaying camera startup.
        const decoder = import("@zxing/browser");
        void decoder.catch(() => {}); // Permission prompts may outlast module loading.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
        if (capabilities?.focusMode?.includes("continuous")) {
          // Optional device support: failure must not prevent scanning on Safari.
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        }
        if (cancelled) return;
        const element = video.current!;
        element.srcObject = stream;
        await element.play();
        const { BrowserMultiFormatReader } = await decoder;
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas unavailable");
        setReady(true);
        setStatus("Držite dugme Skeniraj dok je barkod u kadru.");
        const loop = () => {
          if (cancelled) return;
          if (!allowed.current) setHolding(false);
          if (allowed.current && press.current.active && !document.hidden && element.readyState >= 2 && element.videoWidth) {
            // One-dimensional readers reverse rows for upside-down codes. Rotating
            // the actual canvas also handles vertical codes without clipping pixels.
            for (const rotated of [false, true]) {
              canvas.width = rotated ? element.videoHeight : element.videoWidth;
              canvas.height = rotated ? element.videoWidth : element.videoHeight;
              context.setTransform(1, 0, 0, 1, 0, 0);
              if (rotated) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
              context.drawImage(element, 0, 0);
              try {
                const value = reader.decodeFromCanvas(canvas).getText();
                if (press.current.accept()) {
                  setHolding(false); setStatus(`Očitano: ${value}. Proverite količinu i kliknite Evidentiraj.`);
                  callback.current(value);
                }
                break;
              } catch { /* No readable barcode in this frame: try the next orientation/frame. */ }
            }
          }
          timer = setTimeout(loop, 80);
        };
        loop();
      } catch {
        stream?.getTracks().forEach(track => track.stop());
        if (!cancelled) setError("Kamera nije dostupna. Dozvolite pristup kameri ili koristite skener / ručni unos.");
      }
    };
    void start();
    return () => {
      cancelled = true; trigger.release(); clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  function begin() {
    if (!ready || !enabled || error) return;
    press.current.begin(); setHolding(true); setStatus("Tražim barkod… Držite dugme.");
  }
  function end() { press.current.release(); setHolding(false); }
  return <div className="space-y-3 rounded-xl border bg-black p-3 text-white">
    <div className="relative overflow-hidden rounded-lg">
      <video ref={video} muted playsInline className="max-h-64 w-full" />
      <div aria-hidden className="pointer-events-none absolute inset-x-[10%] inset-y-[20%] rounded-lg border-2 border-white/70" />
    </div>
    <p role="status" aria-live="polite" className="text-sm">{error || status}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!ready || !enabled || !!error} aria-pressed={holding}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); begin(); }}
        onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
        onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) begin(); } }}
        onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); end(); } }}
        onContextMenu={event => event.preventDefault()}
        className="touch-none select-none rounded-lg border bg-white px-4 py-3 font-semibold text-black disabled:opacity-50">
        {holding ? "Skeniram…" : "Držite za skeniranje"}
      </button>
      <button type="button" onClick={onClose} className="rounded-lg border px-4 py-3">Zatvori kameru</button>
    </div>
  </div>;
}
