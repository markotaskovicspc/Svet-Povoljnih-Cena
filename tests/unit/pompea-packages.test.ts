import { describe, expect, it } from "vitest";
import { derivePhysicalPackages, isPompeaItem, requireCompleteXExpressPackages, type PackageSourceItem } from "@/lib/courier/packages";
import { packedItemsValue, parcelOrderItemIds, readPackedItems } from "@/lib/courier/parcel-contents";
import { physicalPackageRouteItem, resolveCourierProvider } from "@/lib/courier/routing";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";
import { buildXExpressArticleLabels } from "@/lib/x-express/article-labels";

const item = (id: string, qty: number): PackageSourceItem => ({
  id, sku: id, name: `POMPEA ${id}`, qty, supplierName: "Modital doo", unitPriceSale: 250,
  categoryName: "Veš", color1: "Crna",
  product: { supplier: { name: "Modital doo" }, barcode: `ean-${id}`,
    courierUnitsPerBox: 2, packQty: 2, unitPackWidthCm: 12, unitPackDepthCm: 10, unitPackHeightCm: 2, grossWeightKg: 0.1 },
});

describe("one Pompea parcel per order", () => {
  it("combines all SKUs and quantities, overriding carton sizes", () => {
    const packages = derivePhysicalPackages([item("A", 3), { ...item("B", 100), unitPriceSale: 500 }]);
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({ packageNo: 1, packedQuantity: 103, weightKg: null, widthCm: null });
    expect(parcelOrderItemIds(packages[0])).toEqual(["A", "B"]);
    expect(packedItemsValue(packages[0].packedItems)).toBe(50750);
    expect(packages[0].packedItems).toEqual([
      expect.objectContaining({ orderItemId: "A", quantity: 3, barcode: "ean-A", color1: "Crna" }),
      expect.objectContaining({ orderItemId: "B", quantity: 100 }),
    ]);
  });
  it("preserves normal carton rules in a mixed order and numbers physical packages once", () => {
    const normal = { ...item("CHAIR", 5), name: "Stolica" };
    const packages = derivePhysicalPackages([item("A", 2), normal, item("B", 3)]);
    expect(packages.map(p => [p.packageNo, p.packedQuantity])).toEqual([[1, 5], [2, 2], [3, 2], [4, 1]]);
    expect(packages.slice(1).every(p => !p.packedItems)).toBe(true);
  });
  it("recognizes supplier and collection snapshots without including other Modital brands", () => {
    const ordinary = { ...item("A", 1), name: "Čarape" };
    expect(isPompeaItem(ordinary)).toBe(false);
    expect(isPompeaItem({ ...ordinary, collectionName: "POMPEA MIMI" })).toBe(true);
    expect(isPompeaItem({ ...ordinary, supplierName: "Pompea" })).toBe(true);
    expect(isPompeaItem({ ...ordinary, product: { collection: { name: "Pompea-Mimi" } } })).toBe(true);
    expect(isPompeaItem({ ...ordinary, name: "POMPEANO" })).toBe(false);
  });
  it("requires measured outer dimensions before booking, while permitting preliminary picking", () => {
    const packages = derivePhysicalPackages([item("A", 2), item("B", 3)]);
    expect(resolveCourierProvider({ shippingMethod: "KURIR", items: packages.map(physicalPackageRouteItem) })).toEqual({ kind: "single", provider: "X_EXPRESS" });
    expect(() => requireCompleteXExpressPackages(packages)).toThrow("stvarne mere");
    const measured = { ...packages[0], routingMeasurements: undefined, weightKg: 1, widthCm: 25, depthCm: 20, heightCm: 10 };
    expect(requireCompleteXExpressPackages([measured])[0].packedItems).toEqual(packages[0].packedItems);
    expect(resolveCourierProvider({ shippingMethod: "KURIR", items: [physicalPackageRouteItem({ ...measured, weightKg: 31 })] })).toEqual({ kind: "single", provider: "MYGLS" });
  });
  it("routes known bulky consolidated contents to MyGLS", () => {
    const packages = derivePhysicalPackages([item("A", 400)]);
    expect(resolveCourierProvider({ shippingMethod: "KURIR", items: packages.map(physicalPackageRouteItem) })).toEqual({ kind: "single", provider: "MYGLS" });
  });
  it("keeps every article on the picking print while counting a shared parcel once per SKU", () => {
    const [pkg] = derivePhysicalPackages([item("A", 2), { ...item("B", 3), sku: "A" }, item("C", 4)]);
    const rows = buildPickupPrintRows([{ id: "parcel", lineGroupKey: "order:1", quantity: 9, ...pkg, orderItem: null }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sku: "A", quantity: 5, packageCount: 1, color: "Crna", quantityDistribution: [{ quantity: 5, orderCount: 1 }] });
    expect(rows[1]).toMatchObject({ sku: "C", quantity: 4, packageCount: 1 });
  });
  it("prints one concise courier label without misidentifying the parcel with one product barcode", () => {
    const packages = derivePhysicalPackages([item("A", 2), item("B", 3)]);
    const labels = buildXExpressArticleLabels({ codes: ["CODE"], packages, items: [], purpose: "ORDER_DELIVERY" });
    expect(labels).toEqual([{ Code: "CODE", name: "POMPEA · 2 stavki · 5 kom", sku: null, barcode: null }]);
  });
  it("rejects corrupt saved contents and missing prices instead of silently dropping merchandise or COD", () => {
    expect(readPackedItems(null)).toEqual([]);
    expect(() => readPackedItems([])).toThrow();
    const contents = derivePhysicalPackages([item("A", 2)])[0].packedItems!;
    expect(() => readPackedItems([...contents, ...contents])).toThrow();
    expect(() => packedItemsValue([{ ...contents[0], unitValue: null }])).toThrow("vrednost");
  });
});
