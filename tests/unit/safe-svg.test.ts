import { describe, expect, it } from "vitest";
import { validateSafeSvgBytes } from "@/lib/media/safe-svg";

const bytes = (source: string) => new TextEncoder().encode(source);

describe("safe SVG uploads", () => {
  it("accepts self-contained SVG artwork", () => {
    expect(
      validateSafeSvgBytes(
        bytes(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#003579" d="M0 0h24v24H0z"/></svg>',
        ),
      ),
    ).toContain("<path");
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/a.png"/></svg>',
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
  ])("rejects active or externally loaded markup", (source) => {
    expect(() => validateSafeSvgBytes(bytes(source))).toThrow();
  });
});
