import { describe, expect, it } from "vitest";
import { formatProductDisplayName } from "@/lib/product-name";

describe("formatProductDisplayName", () => {
  it("appends a configured size to the product name", () => {
    expect(formatProductDisplayName("Majica", "mali")).toBe("Majica – mali");
  });

  it("leaves names without a size unchanged", () => {
    expect(formatProductDisplayName("Majica", null)).toBe("Majica");
    expect(formatProductDisplayName("Majica", "   ")).toBe("Majica");
  });

  it("does not append a size already present at the end of the name", () => {
    expect(formatProductDisplayName("Majica – mali", "mali")).toBe(
      "Majica – mali",
    );
    expect(formatProductDisplayName("Majica (MALI)", "mali")).toBe(
      "Majica (MALI)",
    );
  });
});
