import { describe, expect, it, vi } from "vitest";
import { createPickingCameraDecoder } from "../../src/lib/admin/picking-camera-decoder";
function setup() {
  const context = { setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const missing = () => { throw new Error("NotFound"); };
  const linear = { decodeFromCanvas: vi.fn(missing) };
  const general = { decodeFromCanvas: vi.fn(missing) };
  const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  return { context, canvas, linear, general, video, decode: createPickingCameraDecoder(canvas, linear, general) };
}
describe("picking camera decoder", () => {
  it("preserves native detail instead of shrinking thin barcode bars", () => {
    const { linear, decode, video, canvas } = setup();
    linear.decodeFromCanvas.mockImplementation(() => {
      expect(canvas.width).toBe(1536);
      return { getText: () => "8605078600088" } as never;
    });
    expect(decode(video)).toBe("8605078600088");
  });
  it("tries vertical labels and periodically searches beyond the aim area", () => {
    const { context, decode, video } = setup();
    decode(video); decode(video); decode(video);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080, 0, 0, 1920, 1080);
  });
  it("retains 2D codes through a periodic fallback without searching them on every frame", () => {
    const { general, decode, video } = setup();
    general.decodeFromCanvas.mockImplementation(() => ({ getText: () => "sku-from-qr" }) as never);
    for (let i = 0; i < 5; i++) expect(decode(video)).toBeUndefined();
    expect(general.decodeFromCanvas).not.toHaveBeenCalled();
    expect(decode(video)).toBe("sku-from-qr");
  });
});
