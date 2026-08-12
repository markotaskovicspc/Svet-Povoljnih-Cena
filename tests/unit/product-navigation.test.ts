import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("product navigation", () => {
  it("does not remount and fade the complete storefront on every route", () => {
    expect(existsSync(resolve(process.cwd(), "src/app/template.tsx"))).toBe(false);
  });

  it("keeps product and colour links eligible for native Next.js prefetch", () => {
    const sources = [
      "src/components/product/product-card.tsx",
      "src/components/product/color-options.tsx",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8"));

    for (const source of sources) {
      expect(source).not.toContain("prefetch={false}");
    }
  });
});
