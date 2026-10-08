import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBarcodeCamera } from "@/lib/barcode-camera";
const m = vi.hoisted(() => ({ decode: vi.fn(), media: vi.fn(), trackStop: vi.fn(), readerStop: vi.fn() }));
vi.mock("@zxing/browser", () => ({ BrowserMultiFormatReader: class { decodeFromStream = m.decode; } }));
const stream = { getTracks: () => [{ stop: m.trackStop }] } as unknown as MediaStream;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: m.media } });
  m.media.mockResolvedValue(stream);
  m.decode.mockResolvedValue({ stop: m.readerStop });
});
afterEach(() => vi.unstubAllGlobals());
const video = {} as HTMLVideoElement;
describe("return barcode camera lifecycle", () => {
  it("requests the rear camera without audio and stops after a single scan", async () => {
    const received = vi.fn();
    const camera = startBarcodeCamera(video, received);
    await camera.ready;
    expect(m.media).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const scan = m.decode.mock.calls[0][2];
    scan({ getText: () => "09002838514" }, undefined, { stop: m.readerStop });
    scan({ getText: () => "09002838515" }, undefined, { stop: m.readerStop });
    expect(received).toHaveBeenCalledExactlyOnceWith("09002838514");
    expect(m.trackStop).toHaveBeenCalledTimes(1);
    expect(m.readerStop).toHaveBeenCalled();
    camera.stop();
    expect(m.trackStop).toHaveBeenCalledTimes(1);
  });
  it("stops a late stream when the user closes while granting camera permission", async () => {
    let grant!: (stream: MediaStream) => void;
    let requested!: () => void;
    const pending = new Promise<void>(resolve => { requested = resolve; });
    m.media.mockImplementation(() => { requested(); return new Promise<MediaStream>(resolve => { grant = resolve; }); });
    const camera = startBarcodeCamera(video, vi.fn());
    await pending;
    camera.stop();
    grant(stream);
    await camera.ready;
    expect(m.trackStop).toHaveBeenCalledTimes(1);
    expect(m.decode).not.toHaveBeenCalled();
  });
  it("releases the camera if decoder initialization fails", async () => {
    m.decode.mockRejectedValue(new Error("decoder failed"));
    const camera = startBarcodeCamera(video, vi.fn());
    await expect(camera.ready).rejects.toThrow("decoder failed");
    expect(m.trackStop).toHaveBeenCalledTimes(1);
  });
  it("reports denied permissions without posting or scanning anything", async () => {
    m.media.mockRejectedValue(new Error("permission denied"));
    const received = vi.fn();
    await expect(startBarcodeCamera(video, received).ready).rejects.toThrow("permission denied");
    expect(received).not.toHaveBeenCalled();
    expect(m.decode).not.toHaveBeenCalled();
  });
  it("stops capture on close even without a detected barcode", async () => {
    const camera = startBarcodeCamera(video, vi.fn());
    await camera.ready;
    camera.stop();
    expect(m.trackStop).toHaveBeenCalledTimes(1);
    expect(m.readerStop).toHaveBeenCalledTimes(1);
  });
});
