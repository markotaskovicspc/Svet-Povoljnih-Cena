import { describe, expect, it } from "vitest";
import { presignSchema } from "@/lib/api/uploads";
import { createReclamationPhotoFile } from "@/lib/reclamation-photo-file";

describe("reclamation photo canvas output", () => {
  it("preserves Safari's PNG fallback instead of disguising it as WebP", async () => {
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const blob = new Blob([pngHeader], { type: "image/png" });

    const file = createReclamationPhotoFile(blob, "fotografija.heic");

    expect(file.name).toBe("fotografija.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pngHeader);
    expect(
      presignSchema.safeParse({
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
        orderNumberOrFiscal: "SPC-2026-000106",
        sku: "110081",
      }).success,
    ).toBe(true);
  });

  it("keeps WebP output as WebP when the browser supports it", () => {
    const blob = new Blob(["webp"], { type: "image/webp" });

    const file = createReclamationPhotoFile(blob, "fotografija.jpg");

    expect(file.name).toBe("fotografija.webp");
    expect(file.type).toBe("image/webp");
  });

  it("rejects an unexpected canvas output type", () => {
    const blob = new Blob(["gif"], { type: "image/gif" });

    expect(() => createReclamationPhotoFile(blob, "fotografija.gif")).toThrow(
      "unsupported_canvas_output_type",
    );
  });
});
