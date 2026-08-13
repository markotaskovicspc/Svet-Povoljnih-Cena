import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeRabaluxImageForStorage } from "@/lib/rabalux/image-normalization";
import { isRecoverableRabaluxMediaFailure } from "@/lib/rabalux/media-recovery-policy";

describe("Rabalux media safety", () => {
  it("normalizes a large source image to a bounded WebP", async () => {
    const source = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer();

    const normalized = await normalizeRabaluxImageForStorage(source);

    expect(normalized.contentType).toBe("image/webp");
    expect(normalized.width).toBe(2560);
    expect(normalized.height).toBe(1920);
    expect(normalized.buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect((await sharp(normalized.buffer).metadata()).format).toBe("webp");
  });

  it("rejects malformed image bytes", async () => {
    await expect(
      normalizeRabaluxImageForStorage(Buffer.from("not-an-image")),
    ).rejects.toThrow();
  });

  it("retries transient and legacy 413 failures but not unrelated permanent failures", () => {
    expect(isRecoverableRabaluxMediaFailure("Fetch failed")).toBe(true);
    expect(
      isRecoverableRabaluxMediaFailure(
        "[permanent] Rabalux media cannot fit the configured storage limit: HTTP 413",
      ),
    ).toBe(true);
    expect(
      isRecoverableRabaluxMediaFailure(
        "[permanent] Untrusted Rabalux media source.",
      ),
    ).toBe(false);
  });
});
