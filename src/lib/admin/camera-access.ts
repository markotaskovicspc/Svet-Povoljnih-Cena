/** Relax optional device constraints only when the camera driver rejects them. */
export async function requestScannerCamera() {
  if (typeof document !== "undefined") {
    const policyDocument = document as Document & { permissionsPolicy?: { allowsFeature: (feature: string) => boolean }; featurePolicy?: { allowsFeature: (feature: string) => boolean } };
    const policy = policyDocument.permissionsPolicy ?? policyDocument.featurePolicy;
    if (policy && !policy.allowsFeature("camera")) throw new Error("CAMERA_POLICY_BLOCKED");
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNAVAILABLE");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
    }
    throw error;
  }
}

export function scannerCameraError(error: unknown) {
  if (error instanceof Error && error.message === "CAMERA_POLICY_BLOCKED") return "Ova otvorena stranica blokira kameru. Osvežite admin stranicu ili je ponovo otvorite, pa pokušajte ponovo.";
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Pristup kameri je blokiran. U Chrome-u dodirnite podešavanja levo od adrese → Dozvole → Kamera → Dozvoli, pa pokušajte ponovo. Proverite i dozvolu kamere za Chrome u podešavanjima telefona.";
  if (name === "NotReadableError" || name === "AbortError") return "Kamera je zauzeta ili se nije pokrenula. Zatvorite druge aplikacije koje koriste kameru, pa pokušajte ponovo.";
  if (name === "NotFoundError") return "Kamera nije pronađena. Koristite skener ili unesite kod ručno.";
  return "Kamera ili skener nisu mogli da se pokrenu. Pokušajte ponovo ili unesite kod paketa ručno.";
}
