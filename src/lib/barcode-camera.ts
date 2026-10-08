/** Starts only after a user opens the camera; never uploads camera frames. */
export function startBarcodeCamera(video: HTMLVideoElement, onCode: (code: string) => void) {
  let stopped = false;
  let stream: MediaStream | undefined;
  let controls: { stop: () => void } | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    controls?.stop();
    stream?.getTracks().forEach(track => track.stop());
  };
  const ready = (async () => {
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (stopped) return;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      controls = await new BrowserMultiFormatReader().decodeFromStream(stream, video, (result, _error, scanner) => {
        if (stopped || !result) return;
        stop();
        scanner.stop();
        onCode(result.getText());
      });
      if (stopped) controls.stop();
    } catch (error) {
      const wasStopped = stopped;
      stop();
      if (!wasStopped) throw error;
    }
  })();
  return { ready, stop };
}
