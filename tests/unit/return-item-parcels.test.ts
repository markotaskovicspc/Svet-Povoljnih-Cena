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
