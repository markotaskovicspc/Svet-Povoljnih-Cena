import { describe, expect, it } from "vitest";
import { parseReclamationPackages, reclamationCataloguePackages } from "@/lib/admin/reclamation-packages";
import { resolveCourierProvider, physicalPackageRouteItem } from "@/lib/courier/routing";

const parcel = { weightKg: 0.2, widthCm: 10, depthCm: 5, heightCm: 2 };
describe("catalogue replacement measurements", () => {
  const product = {
    grossWeightKg: "3.125", weightKg: 2,
    unitPackWidthCm: "45", unitPackDepthCm: "50", unitPackHeightCm: "90",
    packQty: 4, packGrossWeightKg: 14, packWidthCm: 100,
    widthCm: 40, depthCm: 40, heightCm: 80,
  };
  const claim = { resolution: "ZAMENA_ARTIKLA", quantity: 4, replacementQty: 1, product };
  it("uses individual packaging and gross weight for the replacement quantity, not the claimed quantity", () => {
    expect(reclamationCataloguePackages(claim)).toEqual([{ weightKg: 3.125, widthCm: 45, depthCm: 50, heightCm: 90 }]);
    expect(reclamationCataloguePackages({ ...claim, replacementQty: 2 })).toHaveLength(2);
    expect(reclamationCataloguePackages({ ...claim, replacementQty: null })).toHaveLength(4);
  });
  it("leaves missing packaging dimensions blank rather than using assembled or transport dimensions", () => {
    expect(reclamationCataloguePackages({ ...claim, product: { ...product, grossWeightKg: null, unitPackWidthCm: null } }))
      .toEqual([{ weightKg: 2, widthCm: null, depthCm: 50, heightCm: 90 }]);
    expect(reclamationCataloguePackages({ ...claim, product: { packGrossWeightKg: 14, packWidthCm: 100 } }))
      .toEqual([{ weightKg: null, widthCm: null, depthCm: null, heightCm: null }]);
  });
  it("respects courier cartons and the existing weight calculation for a partial carton", () => {
    const cartons = { ...product, courierUnitsPerBox: 4 };
    expect(reclamationCataloguePackages({ ...claim, replacementQty: 5, product: cartons }).map((pkg) => pkg.weightKg)).toEqual([14, 3.125]);
    expect(reclamationCataloguePackages({ ...claim, replacementQty: 2, product: cartons })[0].weightKg).toBe(6.25);
  });
  it.each(["ZAMENA_DELA", "POVRAT_NOVCA", "POPUST", null])("does not suggest whole-item measurements for %s", (resolution) => {
    expect(reclamationCataloguePackages({ ...claim, resolution })).toEqual([]);
  });
  it("handles unavailable products and invalid or excessive package counts", () => {
    expect(reclamationCataloguePackages({ ...claim, product: null })).toEqual([]);
    for (const replacementQty of [0, -1, 1.5, 100]) {
      expect(reclamationCataloguePackages({ ...claim, replacementQty })).toEqual([]);
    }
  });
});
describe("measured replacement parcels", () => {
  it.each([null, [], [{ ...parcel, weightKg: 0 }], [{ ...parcel, widthCm: -1 }], [{ weightKg: 1 }], [{ ...parcel, heightCm: NaN }]])("rejects missing or invalid dimensions: %j", (value) => {
    expect(() => parseReclamationPackages(value)).toThrow("Mere zamene");
  });
  it("routes a small part to X Express and mixed parcel sizes wholly to MyGLS", () => {
    const route = (values: unknown) => resolveCourierProvider({ shippingMethod: "KURIR", items: parseReclamationPackages(values).map((pkg, i) => physicalPackageRouteItem({ ...pkg, packageNo: i + 1 })) });
    expect(route([parcel])).toMatchObject({ kind: "single", provider: "X_EXPRESS" });
    expect(route([parcel, { ...parcel, widthCm: 61 }])).toMatchObject({ kind: "single", provider: "MYGLS" });
  });
  it("rejects hard courier limits before a replacement becomes ready", () => {
    expect(() => parseReclamationPackages([{ ...parcel, weightKg: 41 }])).toThrow("40 kg");
    expect(() => parseReclamationPackages([{ ...parcel, widthCm: 201 }])).toThrow("200 cm");
  });
});
