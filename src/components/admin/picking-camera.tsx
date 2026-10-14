"use client";

import { useEffect, useRef, useState } from "react";
import { ScanPress } from "@/lib/admin/scan-press";
import { createPickingCameraDecoder } from "@/lib/admin/picking-camera-decoder";

/** Keep the camera warm; a press accepts at most one code, never inventory. */
export function PickingCamera({ onCode, onClose, enabled = true }: {
  onCode: (code: string) => boolean | void; onClose: () => void; enabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const press = useRef(new ScanPress());
  const scanFrame = useRef<() => void>(() => {});
  const callback = useRef(onCode);
  const allowed = useRef(enabled);
  const decodedVersion = useRef(0);
  const [ready, setReady] = useState(false);
  const [holding, setHolding] = useState(false);
  const [status, setStatus] = useState("Pokretanje kamere…");
  const [error, setError] = useState("");
  useEffect(() => { callback.current = onCode; }, [onCode]);
  useEffect(() => {
    allowed.current = enabled;
    if (!enabled) { press.current.release(); }
    let cancelled = false;
    const version = decodedVersion.current;
    if (enabled && video.current?.srcObject) void video.current.play().then(() => {
      if (!cancelled && version === decodedVersion.current) setStatus("Držite dugme Skeniraj dok je barkod u kadru.");
    }).catch(() => {});
    return () => { cancelled = true; };
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
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
        const { BrowserMultiFormatReader, BrowserMultiFormatOneDReader } = await decoder;
        if (cancelled) return;
        const decode = createPickingCameraDecoder(document.createElement("canvas"), new BrowserMultiFormatOneDReader(), new BrowserMultiFormatReader());
        setReady(true);
        setStatus("Držite dugme Skeniraj dok je barkod u kadru.");
        const loop = () => {
          clearTimeout(timer);
          if (cancelled) return;
          if (!allowed.current) setHolding(false);
          if (allowed.current && press.current.active && !document.hidden && element.readyState >= 2 && element.videoWidth) {
            const value = decode(element);
            if (value && press.current.accept()) {
              decodedVersion.current++;
              setHolding(false); setStatus(`Očitano: ${value}. Proverite količinu i kliknite Evidentiraj.`);
              if (callback.current(value) === false) setStatus("Barkod ne odgovara artiklu. Pokušajte ponovo.");
            }
          }
          timer = setTimeout(loop, press.current.active ? 30 : 150);
        };
        scanFrame.current = loop;
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
      scanFrame.current = () => {};
    };
  }, []);
  function begin() {
    if (!ready || !enabled || error) return;
    press.current.begin(); setHolding(true); setStatus("Tražim barkod… Držite dugme.");
    scanFrame.current();
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
        className="touch-none select-none rounded-lg border bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-50">
        {holding ? "Skeniram…" : "Držite za skeniranje"}
      </button>
      <button type="button" onClick={onClose} className="rounded-lg border px-4 py-3">Zatvori kameru</button>
    </div>
  </div>;
}
