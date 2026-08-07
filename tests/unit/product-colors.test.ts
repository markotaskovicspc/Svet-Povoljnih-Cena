import { describe, expect, it } from "vitest";
import {
  isProductColorLabel,
  normalizeProductColorLabel,
} from "@/lib/product-colors";

describe("product colour labels", () => {
  it("keeps real colours and trims their labels", () => {
    expect(normalizeProductColorLabel("  TAMNO SIVA ")).toBe("TAMNO SIVA");
    expect(isProductColorLabel("SVETLO BRAON")).toBe(true);
  });

  it("rejects dimensions from display and operational colour fields", () => {
    expect(normalizeProductColorLabel("190x80")).toBeNull();
    expect(normalizeProductColorLabel("190 × 80 cm")).toBeNull();
    expect(isProductColorLabel("190x80")).toBe(false);
  });

  it("normalizes empty labels to null", () => {
    expect(normalizeProductColorLabel("   ")).toBeNull();
    expect(normalizeProductColorLabel(null)).toBeNull();
  });
});
