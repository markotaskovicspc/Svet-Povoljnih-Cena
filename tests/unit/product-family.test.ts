import { describe, expect, it } from "vitest";
import {
  defaultProductFamilyLabel,
  normalizeProductFamilyCode,
  normalizeProductFamilyHex,
  normalizeProductFamilyLabel,
  productFamilyReadinessReasons,
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

  it("izvodi naziv samo iz Boje 1 i Boje 2, normalizuje veličinu slova i uklanja duplikat", () => {
    expect(
      defaultProductFamilyLabel({
        colorPrimary: "  CRNA ",
        colorSecondary: "crna",
      }),
    ).toBe("Crna");
    expect(
      defaultProductFamilyLabel({
        colorPrimary: "MASLINASTO ZELENA",
        colorSecondary: "ZLATNA",
      }),
    ).toBe("Maslinasto zelena / Zlatna");
  });

  it("objavu blokira bez boje, READY slike i važeće MP cene", () => {
    expect(
      productFamilyReadinessReasons({
        colorPrimary: null,
        colorSecondary: null,
        hasReadyImage: false,
        publicationBlockers: [
          "Nema važeću pozitivnu stavku aktivnog MP cenovnika",
        ],
      }),
    ).toEqual([
      "Nije uneta Boja 1",
      "Nema važeću pozitivnu stavku aktivnog MP cenovnika",
      "Nema spremnu glavnu fotografiju",
    ]);
  });
});
