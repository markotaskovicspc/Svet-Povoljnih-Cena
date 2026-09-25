import { describe, expect, it } from "vitest";
import {
  derivePhysicalPackages,
  hasKnownMyGlsHardLimitViolation,
  hasKnownMyGlsOversizeSurcharge,
  hasKnownXExpressHardLimitViolation,
  requireCompleteMyGlsPackages,
  requireCompleteXExpressPackages,
} from "@/lib/courier/packages";

describe("physical courier packages", () => {
  it("creates one courier package per sold unit regardless of catalogue pack quantity", () => {
    const packages = derivePhysicalPackages([
      {
        id: "item-1",
        name: "Stolica",
        qty: 5,
        product: {
          packQty: 2,
          grossWeightKg: 3.5,
          packGrossWeightKg: 8,
          unitPackWidthCm: 40,
          unitPackDepthCm: 50,
          unitPackHeightCm: 30,
        },
      },
    ]);

    expect(packages).toHaveLength(5);
    expect(packages).toEqual(
      Array.from({ length: 5 }, (_, index) =>
        expect.objectContaining({
          packageNo: index + 1,
          weightKg: 3.5,
          widthCm: 40,
        }),
      ),
    );
  });

  it("never derives courier weight from a transport package", () => {
    const packages = derivePhysicalPackages([
      {
        id: "item-1",
        name: "Blender",
        qty: 2,
        product: {
          packQty: 2,
          packGrossWeightKg: 8,
          unitPackWidthCm: 40,
          unitPackDepthCm: 50,
          unitPackHeightCm: 30,
        },
      },
    ]);

    expect(packages).toHaveLength(2);
    expect(packages.map((pkg) => pkg.weightKg)).toEqual([null, null]);
    expect(() => requireCompleteXExpressPackages(packages)).toThrow(
      "nema kompletne stvarne mere: težina",
    );
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

  it("uses individual article packaging before assembled dimensions", () => {
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

  it("ignores transport packaging when individual article packaging exists", () => {
    const [pkg] = derivePhysicalPackages([
      {
        id: "item-1",
        name: "Stolica",
        qty: 1,
        product: {
          unitPackWidthCm: 61,
          unitPackDepthCm: 42,
          unitPackHeightCm: 19,
          packWidthCm: 120,
          packDepthCm: 80,
          packHeightCm: 50,
        },
      },
    ]);
    expect(pkg).toMatchObject({
      widthCm: 61,
      depthCm: 42,
      heightCm: 19,
    });
  });

  it("does not fall back to transport or assembled dimensions", () => {
    const [pkg] = derivePhysicalPackages([
      {
        id: "item-1",
        name: "Stolica",
        qty: 1,
        product: {
          packWidthCm: 120,
          packDepthCm: 80,
          packHeightCm: 50,
          widthCm: 55,
          depthCm: 45,
          heightCm: 90,
        },
      },
    ]);
    expect(pkg).toMatchObject({
      widthCm: null,
      depthCm: null,
      heightCm: null,
    });
  });

  it("uses individual packaging regardless of empty transport measures", () => {
    const [pkg] = derivePhysicalPackages([
      {
        id: "item-1",
        name: "Lampa",
        qty: 1,
        product: {
          packGrossWeightKg: 0,
          packWidthCm: 0,
          packDepthCm: 0,
          packHeightCm: 0,
          grossWeightKg: 2,
          unitPackWidthCm: 44,
          unitPackDepthCm: 35,
          unitPackHeightCm: 59,
        },
      },
    ]);
    expect(pkg).toMatchObject({
      weightKg: 2,
      widthCm: 44,
      depthCm: 35,
      heightCm: 59,
    });
  });

  it("enforces hard GLS weight and side limits without blocking surcharge dimensions", () => {
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
    ).not.toThrow();
  });

  it("separates hard MyGLS limits from the category-II surcharge boundary", () => {
    expect(
      hasKnownMyGlsHardLimitViolation({
        packageNo: 1,
        weightKg: 39,
        widthCm: 190,
        depthCm: 120,
        heightCm: 90,
      }),
    ).toBe(false);
    expect(
      hasKnownMyGlsOversizeSurcharge({
        packageNo: 1,
        weightKg: 39,
        widthCm: 190,
        depthCm: 120,
        heightCm: 90,
      }),
    ).toBe(true);
    expect(
      hasKnownMyGlsOversizeSurcharge({
        packageNo: 2,
        weightKg: 32,
        widthCm: 72,
        depthCm: 129,
        heightCm: 14,
      }),
    ).toBe(true);
    expect(
      hasKnownMyGlsHardLimitViolation({
        packageNo: 1,
        weightKg: 40.1,
        widthCm: 100,
        depthCm: 40,
        heightCm: 20,
      }),
    ).toBe(true);
    expect(
      hasKnownMyGlsOversizeSurcharge({
        packageNo: 1,
        weightKg: 10,
        widthCm: 100,
        depthCm: null,
        heightCm: 40,
      }),
    ).toBe(false);
  });

  it("enforces the published X Express 30 kg and 60 cm package limits", () => {
    const base = {
      packageNo: 1,
      weightKg: 10,
      widthCm: 40,
      depthCm: 50,
      heightCm: 30,
    };

    expect(() => requireCompleteXExpressPackages([{ ...base, weightKg: 30.1 }])).toThrow(
      "30 kg",
    );
    expect(() => requireCompleteXExpressPackages([{ ...base, heightCm: 60.1 }])).toThrow(
      "60 cm",
    );
    expect(() => requireCompleteXExpressPackages([{ ...base, weightKg: 30, heightCm: 60 }])).not.toThrow();
    expect(hasKnownXExpressHardLimitViolation({ ...base, depthCm: 61 })).toBe(true);
  });

  it.each([0, null])("still requires actual weight before creating an X Express label (weight %s)", (weightKg) => {
    expect(() => requireCompleteXExpressPackages([{ packageNo: 1, weightKg, widthCm: 17, depthCm: 17, heightCm: 25 }])).toThrow("težina");
  });
});

describe("explicit courier cartons", () => {
  const product = { courierUnitsPerBox: 2, packQty: 2, packGrossWeightKg: 12,
    packWidthCm: 50, packDepthCm: 45, packHeightCm: 55,
    grossWeightKg: 5, unitPackWidthCm: 30, unitPackDepthCm: 25, unitPackHeightCm: 35 };
  it.each([[1, 1], [2, 1], [3, 2], [4, 2], [5, 3]])("packs %s units into %s parcels", (qty, count) => {
    const packages = derivePhysicalPackages([{ id: "i", name: "Stolica", qty, product }]);
    expect(packages).toHaveLength(count);
    expect(packages.reduce((sum, pkg) => sum + pkg.packedQuantity!, 0)).toBe(qty);
    expect(packages.map(pkg => pkg.packageNo)).toEqual(Array.from({length: count}, (_, i) => i + 1));
  });
  it("uses the full carton measurements and individual measurements for the odd unit", () => {
    expect(derivePhysicalPackages([{ id: "i", name: "Stolica", qty: 3, product }])).toMatchObject([
      { packedQuantity: 2, weightKg: 12, widthCm: 50, depthCm: 45, heightCm: 55 },
      { packedQuantity: 1, weightKg: 5, widthCm: 30, depthCm: 25, heightCm: 35 },
    ]);
  });
  it("does not invent a weight for a partially filled carton", () => {
    const packages = derivePhysicalPackages([{ id: "i", name: "Stolica", qty: 2,
      product: { ...product, courierUnitsPerBox: 4, packQty: 4 } }]);
    expect(packages[0]).toMatchObject({ packedQuantity: 2, weightKg: null });
    expect(() => requireCompleteXExpressPackages(packages)).toThrow("težina");
  });
});
