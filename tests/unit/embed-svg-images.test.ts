import { describe, expect, it } from "vitest";
import {
  embedSvgLinkedImages,
  SvgCompanionRequiredError,
  svgReferenceFileName,
} from "@/lib/media/embed-svg-images";
import { validateSafeSvgBytes } from "@/lib/media/safe-svg";

const svgBytes = (body: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`,
  );

const rasterFixtures = {
  "slika.png": new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]),
  "slika.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
  "slika.webp": new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]),
  "slika.avif": new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
  ]),
};

describe("embedding linked SVG images", () => {
  it.each(Object.entries(rasterFixtures))(
    "embeds a linked %s companion and produces a safe standalone SVG",
    (name, bytes) => {
      const output = embedSvgLinkedImages(
        svgBytes(`<image href="../assets/${name}"/>`),
        [{ name, bytes }],
      );
      const source = validateSafeSvgBytes(output.bytes);

      expect(source).toContain("data:image/");
      expect(source).not.toContain("../assets/");
      expect(output.embedded).toEqual([name]);
    },
  );

  it("matches URL-encoded names and legacy xlink references", () => {
    const output = embedSvgLinkedImages(
      svgBytes(
        '<image xlink:href="https://cdn.example.test/moja%20slika.png?size=2#crop"/>',
      ),
      [{ name: "moja slika.png", bytes: rasterFixtures["slika.png"] }],
    );

    expect(validateSafeSvgBytes(output.bytes)).toContain(
      "data:image/png;base64",
    );
  });

  it("supports raster references inside SVG filters", () => {
    const output = embedSvgLinkedImages(
      svgBytes('<filter><feImage href="slika.webp"/></filter>'),
      [{ name: "slika.webp", bytes: rasterFixtures["slika.webp"] }],
    );

    expect(validateSafeSvgBytes(output.bytes)).toContain(
      "data:image/webp;base64",
    );
  });

  it("leaves pure vector, internal and already embedded references intact", () => {
    const source = svgBytes(
      '<defs><linearGradient id="paint"/></defs><rect fill="url(#paint)"/><use href="#shape"/><image href="data:image/png;base64,iVBORw0KGgo="/>',
    );
    const output = embedSvgLinkedImages(source, []);

    expect(output.embedded).toEqual([]);
    expect(validateSafeSvgBytes(output.bytes)).toContain("url(#paint)");
  });

  it("reports every missing companion without requiring manual SVG editing", () => {
    expect(() =>
      embedSvgLinkedImages(
        svgBytes(
          '<image href="../a/logo.png"/><image href="../b/photo.jpg"/>',
        ),
        [],
      ),
    ).toThrowError(
      expect.objectContaining<SvgCompanionRequiredError>({
        code: "SVG_COMPANION_REQUIRED",
        missing: ["logo.png", "photo.jpg"],
      }),
    );
  });

  it("rejects mislabeled and ambiguous companion files", () => {
    expect(() =>
      embedSvgLinkedImages(svgBytes('<image href="slika.png"/>'), [
        { name: "slika.png", bytes: new TextEncoder().encode("not an image") },
      ]),
    ).toThrow("ispravan PNG, JPG, WebP ili AVIF");

    expect(() =>
      embedSvgLinkedImages(svgBytes('<image href="slika.png"/>'), [
        { name: "slika.png", bytes: rasterFixtures["slika.png"] },
        { name: "SLIKA.PNG", bytes: rasterFixtures["slika.png"] },
      ]),
    ).toThrow("više pratećih fajlova");
  });

  it("extracts companion names from relative, Windows and encoded paths", () => {
    expect(svgReferenceFileName("../_brand/logo.png")).toBe("logo.png");
    expect(svgReferenceFileName("..\\_brand\\logo.jpg")).toBe("logo.jpg");
    expect(svgReferenceFileName("https://cdn.test/moja%20slika.webp?v=1")).toBe(
      "moja slika.webp",
    );
  });
});
