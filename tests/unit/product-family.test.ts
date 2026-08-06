import { describe, expect, it } from "vitest";
import {
  defaultProductFamilyLabel,
  normalizeProductFamilyCode,
  normalizeProductFamilyHex,
  normalizeProductFamilyLabel,
  productFamilyLabelKey,
} from "@/lib/product-family";

describe("porodice boja proizvoda", () => {
  it("normalizuje eksplicitnu šifru bez grupisanja po nazivu", () => {
    expect(normalizeProductFamilyCode(" smak ugaona / 2026 ")).toBe(
      "SMAK-UGAONA-2026",
    );
  });

  it("čuva prikaz naziva, a pravi stabilan ključ za jedinstvenost", () => {
    expect(normalizeProductFamilyLabel("  Crna   / zlatna ")).toBe(
      "Crna / zlatna",
    );
    expect(productFamilyLabelKey("Žuta")).toBe("zuta");
  });

  it("validira HEX i izvodi dvobojni naziv iz artikla", () => {
    expect(normalizeProductFamilyHex("aabbcc")).toBe("#AABBCC");
    expect(
      defaultProductFamilyLabel({
        colorPrimary: "Crna",
        colorSecondary: "Zlatna",
      }),
    ).toBe("Crna / Zlatna");
    expect(() => normalizeProductFamilyHex("#fff")).toThrow(/#RRGGBB/);
  });
});
