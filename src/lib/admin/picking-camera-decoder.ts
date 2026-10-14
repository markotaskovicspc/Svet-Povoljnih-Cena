import type { BrowserMultiFormatOneDReader, BrowserMultiFormatReader } from "@zxing/browser";

/** Preserve native pixel detail; prioritize the aim area with a full-frame fallback. */
export function createPickingCameraDecoder(
  canvas: HTMLCanvasElement,
  linear: Pick<BrowserMultiFormatOneDReader, "decodeFromCanvas">,
  general: Pick<BrowserMultiFormatReader, "decodeFromCanvas">,
) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas unavailable");
  let attempts = 0;
  return (video: HTMLVideoElement): string | undefined => {
    attempts++;
    const width = video.videoWidth, height = video.videoHeight;
    const fullFrame = attempts % 3 === 0;
    // Linear decoding avoids the expensive search for QR/DataMatrix/Aztec on
    // every failed frame. Keep a periodic general fallback for existing 2D codes.
    const readers = attempts % 6 === 0 ? [linear, general] : [linear];
    for (const reader of readers) {
      for (const rotated of [false, true]) {
        const sw = fullFrame ? width : Math.round(width * (rotated ? 0.6 : 0.8));
        const sh = fullFrame ? height : Math.round(height * (rotated ? 0.8 : 0.6));
        const sx = (width - sw) / 2, sy = (height - sh) / 2;
        const cw = rotated ? sh : sw, ch = rotated ? sw : sh;
        // Resizing a canvas reallocates its buffer: only do it when dimensions change.
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        context.setTransform(1, 0, 0, 1, 0, 0);
        if (rotated) { context.translate(cw, 0); context.rotate(Math.PI / 2); }
        context.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        try { return reader.decodeFromCanvas(canvas).getText(); }
        catch { /* Next orientation/frame; camera errors are handled by its owner. */ }
      }
    }
  };
}
