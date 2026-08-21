import { describe, expect, it } from "vitest";
import { validateMobileShortcutIconUpload } from "@/lib/mobile-shortcuts/icon-file";

const svgBytes = (body: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`,
  );

describe("mobile shortcut icon uploads", () => {
  it("accepts a safe SVG pictogram", () => {
    expect(
      validateMobileShortcutIconUpload(
        { name: "akcija.svg", size: 128, type: "image/svg+xml" },
        svgBytes('<path d="M0 0h24v24H0z"/>'),
      ),
    ).toBe("svg");
  });

  it("rejects active SVG content", () => {
    expect(() =>
      validateMobileShortcutIconUpload(
        { name: "akcija.svg", size: 128, type: "image/svg+xml" },
        svgBytes("<script>alert(1)</script>"),
      ),
    ).toThrow("nedozvoljen aktivni sadržaj");
  });
});
