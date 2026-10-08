import { describe, expect, it } from "vitest";
import { derivePhysicalPackages, requireCompleteMyGlsPackages, requireCompleteXExpressPackages, type PackageSourceItem } from "@/lib/courier/packages";
import { physicalPackageRouteItem, resolveCourierProvider } from "@/lib/courier/routing";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";

const chair: PackageSourceItem = {
  id: "city-line", sku: "110174", name: "Trpezarijska stolica CITY LINE", qty: 16,
  product: { courierUnitsPerBox: 2, unitPackWidthCm: 53, unitPackDepthCm: 45, unitPackHeightCm: 51, grossWeightKg: 3.5 },
};
const route = (items: PackageSourceItem[]) => resolveCourierProvider({
  shippingMethod: "KURIR", items: derivePhysicalPackages(items).map(physicalPackageRouteItem),
});

describe("picking of grouped packages", () => {
  it("includes CITY LINE's 16 units in eight packages with individual packaging dimensions and summed gross weight", () => {
    const packages = derivePhysicalPackages([chair]);
    expect(route([chair])).toEqual({ kind: "single", provider: "X_EXPRESS" });
    expect(packages).toHaveLength(8);
    expect(packages.every(pkg => pkg.widthCm === 53 && pkg.heightCm === 51 && pkg.depthCm === 45 && pkg.weightKg === 7)).toBe(true);
    expect(buildPickupPrintRows(packages.map(pkg => ({
      ...pkg, id: `parcel-${pkg.packageNo}`, lineGroupKey: "order:1", quantity: 16,
      orderItem: { id: chair.id, sku: chair.sku!, name: chair.name, qty: chair.qty },
    })))).toMatchObject([{ sku: "110174", quantity: 16, packageCount: 8 }]);
    expect(requireCompleteXExpressPackages(packages)).toHaveLength(8);
    expect(requireCompleteMyGlsPackages(packages)).toHaveLength(8);
  });

  it("preserves an odd remainder and the whole order's courier", () => {
    const packages = derivePhysicalPackages([{ ...chair, qty: 5 }]);
    expect(packages.map(pkg => pkg.packedQuantity)).toEqual([2, 2, 1]);
    expect(packages[2]).toMatchObject({ weightKg: 3.5, widthCm: 53, depthCm: 45, heightCm: 51 });
    expect(route([chair, { id: "table", name: "Sto", qty: 1, product: {
      unitPackWidthCm: 90, unitPackDepthCm: 40, unitPackHeightCm: 10, grossWeightKg: 10,
    } }])).toEqual({ kind: "single", provider: "MYGLS" });
  });

  it.each([
    { unitPackHeightCm: 80 }, { grossWeightKg: 16 },
  ])("keeps known bulky or heavy cartons on MyGLS: %j", dimensions => {
    expect(route([{ ...chair, product: { ...chair.product, ...dimensions } }])).toEqual({ kind: "single", provider: "MYGLS" });
  });

  it("uses measured carton values before preliminary hints", () => {
    const [pkg] = derivePhysicalPackages([chair]);
    const measured = { ...pkg, weightKg: 7, widthCm: 65, depthCm: 50, heightCm: 55 };
    expect(resolveCourierProvider({ shippingMethod: "KURIR", items: [physicalPackageRouteItem(measured)] })).toEqual({ kind: "single", provider: "MYGLS" });
    expect(() => requireCompleteXExpressPackages([measured])).toThrow("60 cm");
    expect(requireCompleteMyGlsPackages([measured])[0]).toMatchObject({ weightKg: 7, widthCm: 65, packedQuantity: 2 });
  });

  it("does not change the missing-dimension policy for ordinary individual parcels", () => {
    expect(route([{ id: "unknown", name: "Artikal", qty: 1 }])).toEqual({ kind: "invalid_dimensions" });
  });
});
