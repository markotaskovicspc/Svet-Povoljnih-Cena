"use client";

import { useEffect, useRef, useState } from "react";
import { requestScannerCamera, scannerCameraError } from "@/lib/admin/camera-access";
import { createPickingCameraDecoder } from "@/lib/admin/picking-camera-decoder";

/** Opening the camera starts recognition; a valid code is accepted once. */
export function PickingCamera({ onCode, onClose, enabled = true }: {
  onCode: (code: string) => boolean | void; onClose: () => void; enabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const accepted = useRef(false);
  const callback = useRef(onCode);
  const allowed = useRef(enabled);
  const decodedVersion = useRef(0);
  const [status, setStatus] = useState("Pokretanje kamere…");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { callback.current = onCode; }, [onCode]);
  useEffect(() => {
    allowed.current = enabled;
    if (enabled) accepted.current = false;
    let cancelled = false;
    const version = decodedVersion.current;
    if (enabled && video.current?.srcObject) void video.current.play().then(() => {
      if (!cancelled && version === decodedVersion.current) setStatus("Usmerite kameru ka barkodu. Skeniranje je automatsko.");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);
  useEffect(() => {
    let rejectedCode = "", rejectedAt = 0;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      try {
        // Load the decoder while the camera starts rather than delaying camera startup.
        const decoder = import("@zxing/browser");
        void decoder.catch(() => {}); // Permission prompts may outlast module loading.
        setError("");
        setStatus("Pokretanje kamere…");
        stream = await requestScannerCamera();
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
        setStatus("Usmerite kameru ka barkodu. Skeniranje je automatsko.");
        const loop = () => {
          clearTimeout(timer);
          if (cancelled) return;
          if (allowed.current && !accepted.current && !document.hidden && element.readyState >= 2 && element.videoWidth) {
            const value = decode(element);
            if (value && (value !== rejectedCode || Date.now() - rejectedAt > 1500)) {
              accepted.current = true;
              decodedVersion.current++;
              setStatus(`Očitano: ${value}. Proverite količinu i kliknite Evidentiraj.`);
              if (callback.current(value) === false) { accepted.current = false; rejectedCode = value; rejectedAt = Date.now(); setStatus("Barkod ne odgovara artiklu. Usmerite kameru ka odgovarajućem barkodu."); }
            }
          }
          timer = setTimeout(loop, allowed.current && !accepted.current ? 60 : 200);
        };
        loop();
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        if (!cancelled) setError(scannerCameraError(error));
      }
    };
    void start();
    return () => {
      cancelled = true; clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [attempt]);
  return <div className="space-y-3 rounded-xl border bg-black p-3 text-white">
    <div className="relative overflow-hidden rounded-lg">
      <video ref={video} muted playsInline aria-label="Kamera za skeniranje barkoda" className="max-h-64 w-full" />
      <div aria-hidden className="pointer-events-none absolute inset-x-[10%] inset-y-[20%] rounded-lg border-2 border-white/70" />
    </div>
    <p role="status" aria-live="polite" className="text-sm">{error || status}</p>
    <div className="flex flex-wrap gap-3">
      {error && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg bg-white px-4 py-3 text-black">Pokušaj ponovo</button>}
      <button type="button" onClick={onClose} className="rounded-lg border px-4 py-3">Zatvori kameru</button>
    </div>
  </div>;
}
