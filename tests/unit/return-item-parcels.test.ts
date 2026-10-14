import { expect, it } from "vitest";
import { displayReturnParcelNumber, returnItemParcelNumbers } from "@/lib/admin/return-parcels";
it("matches X Express label snapshots by SKU rather than array order", () => {
  const shipment = { id: "s", provider: "X_EXPRESS", providerParcelNumbers: ["AAA2", "AAA1"], rawCreateResponse: { articleLabels: [
    { Code: "AAA1", sku: "FEN" }, { Code: "AAA2", sku: "MOP" },
  ] } };
  expect(returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [shipment]).map(p => p.code)).toEqual(["AAA2"]);
});
it("shows the same shared parcel for every packed item", () => {
  const shipment = { id: "s", provider: "X_EXPRESS", trackingNo: "AAA1", rawCreateResponse: { articleLabels: [
    { Code: "AAA1", packedItems: [{ orderItemId: "mop" }, { orderItemId: "fen" }] },
  ] } };
  for (const id of ["mop", "fen"]) expect(returnItemParcelNumbers({ id, sku: id }, [shipment]).map(p => p.code)).toEqual(["AAA1"]);
});
it("uses GLS item assignments and preserves printed leading zeros", () => {
  const shipment = { id: "s", provider: "MYGLS", providerParcelNumbers: [9002829867, 9002829868], rawCreateResponse: { myGlsPackageAssignments: [
    { parcelNumber: 9002829868, orderItemId: "fen" }, { parcelNumber: 9002829867, orderItemId: "mop" },
  ] } };
  const [parcel] = returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [shipment]);
  expect(displayReturnParcelNumber(parcel.code, parcel.shipment.provider)).toBe("09002829867");
});
it("does not guess an item code or show a label outside the returned shipment", () => {
  expect(returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [{ id: "s", trackingNo: "AAA1" }])).toEqual([]);
  expect(returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [{ id: "s", trackingNo: "AAA1", rawCreateResponse: { articleLabels: [{ Code: "AAA2", sku: "MOP" }] } }])).toEqual([]);
});

it("maps identical units to saved packed quantities, including two units in one box", async () => {
  const { returnUnitParcelNumbers } = await import("@/lib/admin/return-parcels");
  const item = { id: "mop", sku: "MOP", qty: 3 };
  const shipment = { id: "s", provider: "X_EXPRESS", providerParcelNumbers: ["AAA1", "AAA2"], rawCreateResponse: { articleLabels: [
    { Code: "AAA1", sku: "MOP", packedQuantity: 2 }, { Code: "AAA2", sku: "MOP", packedQuantity: 1 },
  ] } };
  expect(returnUnitParcelNumbers(item, [shipment], 2)).toMatchObject({ exact: true, parcels: [{ code: "AAA1" }] });
  expect(returnUnitParcelNumbers(item, [shipment], 3)).toMatchObject({ exact: true, parcels: [{ code: "AAA2" }] });
  expect(returnUnitParcelNumbers({ ...item, qty: 4 }, [shipment], 1)).toMatchObject({ exact: false });
});

it("recovers exact mixed-box contents from picking when the courier snapshot lacks quantities", async () => {
  const { returnUnitParcelNumbers } = await import("@/lib/admin/return-parcels");
  const packed = (orderItemId: string, quantity: number) => ({ orderItemId, quantity, sku: orderItemId, name: orderItemId, barcode: null, categoryName: null, color1: null, color2: null, unitValue: null });
  const shipment = { id: "s", provider: "X_EXPRESS", providerParcelNumbers: ["AAA1", "AAA2"], rawCreateResponse: { articleLabels: [{ Code: "AAA1", sku: "mop" }, { Code: "AAA2", sku: "mop" }] }, pickupBatchLines: [
    { providerParcelNumber: "AAA2", packedItems: [packed("mop", 1)] },
    { providerParcelNumber: "AAA1", packedItems: [packed("mop", 2), packed("fen", 1)] },
  ] };
  expect(returnUnitParcelNumbers({ id: "mop", sku: "mop", qty: 3 }, [shipment], 1)).toMatchObject({ exact: true, parcels: [{ code: "AAA1", quantity: 2 }] });
  expect(returnUnitParcelNumbers({ id: "mop", sku: "mop", qty: 3 }, [shipment], 3)).toMatchObject({ exact: true, parcels: [{ code: "AAA2", quantity: 1 }] });
  expect(returnUnitParcelNumbers({ id: "fen", sku: "fen", qty: 1 }, [shipment], 1)).toMatchObject({ exact: true, parcels: [{ code: "AAA1", quantity: 1 }] });
});

it("recovers single-item picking quantities without assigning unrelated or incomplete units", async () => {
  const { returnUnitParcelNumbers } = await import("@/lib/admin/return-parcels");
  const shipment = { id: "s", provider: "X_EXPRESS", trackingNo: "AAA1", pickupBatchLines: [{ providerParcelNumber: "AAA1", orderItemId: "mop", packedQuantity: 2 }] };
  expect(returnUnitParcelNumbers({ id: "mop", sku: "MOP", qty: 2 }, [shipment], 2)).toMatchObject({ exact: true });
  expect(returnUnitParcelNumbers({ id: "mop", sku: "MOP", qty: 3 }, [shipment], 1)).toMatchObject({ exact: false });
  expect(returnItemParcelNumbers({ id: "fen", sku: "MOP" }, [shipment])).toEqual([]);
  expect(returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [{ ...shipment, trackingNo: "OTHER" }])).toEqual([]);
});

it("refuses duplicate parcel mappings and malformed mixed-box contents", () => {
  const line = { providerParcelNumber: "AAA1", orderItemId: "mop", packedQuantity: 1 };
  const shipment = { id: "s", trackingNo: "AAA1", pickupBatchLines: [line, line] };
  expect(() => returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [shipment])).toThrow("Više paketa");
  expect(() => returnItemParcelNumbers({ id: "mop", sku: "MOP" }, [{ ...shipment, pickupBatchLines: [{ ...line, packedItems: [{ orderItemId: "mop", quantity: -1 }] }] }])).toThrow("Neispravan sadržaj");
});

it("preserves previously exact courier ordering so retries keep the same receipt unit keys", async () => {
  const { returnUnitParcelNumbers } = await import("@/lib/admin/return-parcels");
  const shipment = { id: "s", provider: "X_EXPRESS", providerParcelNumbers: ["AAA1", "AAA2"], rawCreateResponse: { articleLabels: [{ Code: "AAA2", sku: "MOP", packedQuantity: 1 }, { Code: "AAA1", sku: "MOP", packedQuantity: 2 }] }, pickupBatchLines: [{ providerParcelNumber: "AAA1", orderItemId: "mop", packedQuantity: 2 }, { providerParcelNumber: "AAA2", orderItemId: "mop", packedQuantity: 1 }] };
  expect(returnUnitParcelNumbers({ id: "mop", sku: "MOP", qty: 3 }, [shipment], 1)).toMatchObject({ exact: true, parcels: [{ code: "AAA2" }] });
});
