import { afterEach, describe, expect, it, vi } from "vitest";
import { requestScannerCamera, scannerCameraError } from "@/lib/admin/camera-access";
import config from "../../next.config";
afterEach(() => vi.unstubAllGlobals());
describe("warehouse camera permission and driver compatibility", () => {
  it("allows capture on the initial admin document as well as both scanner routes", async () => {
    const rules = await config.headers!();
    for (const path of ["/admin", "/admin/magacin/prijava", "/admin/magacin/povrat", "/admin/erp/povrati", "/admin/magacin/picking/1"]) {
      let policy = "";
      for (const rule of rules) {
        if (rule.source === "/:path*" || (rule.source === "/admin/:path*" && path.startsWith("/admin"))) {
          policy = rule.headers.find(h => h.key === "Permissions-Policy")?.value ?? policy;
        }
      }
      expect(policy).toContain("camera=(self)");
    }
    expect(rules.find(r => r.source === "/:path*")?.headers.find(h => h.key === "Permissions-Policy")?.value).toContain("camera=()");
  });
  it("relaxes resolution on an overconstrained driver without requesting audio", async () => {
    const media = vi.fn().mockRejectedValueOnce(new DOMException("resolution", "OverconstrainedError")).mockResolvedValueOnce("stream");
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
    expect(await requestScannerCamera()).toBe("stream");
    expect(media).toHaveBeenLastCalledWith({ audio: false, video: { facingMode: { ideal: "environment" } } });
  });
  it("asks to refresh a document loaded with the old blocking policy", async () => {
    const media = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
    vi.stubGlobal("document", { permissionsPolicy: { allowsFeature: () => false } });
    await expect(requestScannerCamera()).rejects.toThrow("CAMERA_POLICY_BLOCKED");
    expect(media).not.toHaveBeenCalled();
    expect(scannerCameraError(new Error("CAMERA_POLICY_BLOCKED"))).toContain("Osvežite admin stranicu");
  });
  it("does not retry a denied permission and explains how to enable it", async () => {
    const error = new DOMException("denied", "NotAllowedError"), media = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
    await expect(requestScannerCamera()).rejects.toBe(error);
    expect(media).toHaveBeenCalledTimes(1);
    expect(scannerCameraError(error)).toContain("Dozvoli");
    expect(scannerCameraError(new DOMException("busy", "NotReadableError"))).toContain("Zatvorite druge aplikacije");
  });
});
