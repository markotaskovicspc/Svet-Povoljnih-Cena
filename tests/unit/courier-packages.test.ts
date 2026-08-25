import { describe, expect, it } from "vitest";
import {
  derivePhysicalPackages,
  hasKnownMyGlsLimitViolation,
  requireCompleteMyGlsPackages,
} from "@/lib/courier/packages";

describe("physical courier packages", () => {
  it("expands quantity by catalogue pack quantity and copies real pack measures", () => {
    expect(
      derivePhysicalPackages([
        {
          id: "item-1",
          name: "Stolica",
          qty: 5,
          product: {
            packQty: 2,
            packGrossWeightKg: 8,
            packWidthCm: 40,
            packDepthCm: 50,
            packHeightCm: 30,
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({ packageNo: 1, weightKg: 8, widthCm: 40 }),
      expect.objectContaining({ packageNo: 2, weightKg: 8, widthCm: 40 }),
      expect.objectContaining({ packageNo: 3, weightKg: 8, widthCm: 40 }),
    ]);
  });

  it("leaves missing catalogue measurements empty for explicit operator entry", () => {
    const [pkg] = derivePhysicalPackages([
      { id: "item-1", name: "Lampa", qty: 1, product: null },
    ]);
    expect(pkg).toMatchObject({
      weightKg: null,
      widthCm: null,
      depthCm: null,
      heightCm: null,
    });
  });

  it("falls back from transport packaging to individual article packaging", () => {
    const [pkg] = derivePhysicalPackages([
      {
        id: "item-1",
        name: "Lampa",
        qty: 1,
        product: {
          grossWeightKg: 2,
          unitPackWidthCm: 25,
          unitPackDepthCm: 15,
          unitPackHeightCm: 40,
          widthCm: 20,
          depthCm: 10,
          heightCm: 35,
        },
      },
    ]);
    expect(pkg).toMatchObject({
      weightKg: 2,
      widthCm: 25,
      depthCm: 15,
      heightCm: 40,
    });
  });

  it("enforces GLS weight, side and girth limits", () => {
    const base = {
      packageNo: 1,
      weightKg: 10,
      widthCm: 40,
      depthCm: 50,
      heightCm: 30,
    };
    expect(() => requireCompleteMyGlsPackages([{ ...base, weightKg: 40.1 }])).toThrow("40 kg");
    expect(() => requireCompleteMyGlsPackages([{ ...base, widthCm: 201 }])).toThrow("200 cm");
    expect(() =>
      requireCompleteMyGlsPackages([{ ...base, widthCm: 100, depthCm: 60, heightCm: 60 }]),
    ).toThrow("300 cm");
  });

  it("recognizes known MyGLS limit violations without rejecting missing measurements", () => {
    expect(
      hasKnownMyGlsLimitViolation({
        packageNo: 1,
        weightKg: 39,
        widthCm: 190,
        depthCm: 120,
        heightCm: 90,
      }),
    ).toBe(true);
    expect(
      hasKnownMyGlsLimitViolation({
        packageNo: 1,
        weightKg: 10,
        widthCm: 100,
        depthCm: null,
        heightCm: 40,
      }),
    ).toBe(false);
  });
});
