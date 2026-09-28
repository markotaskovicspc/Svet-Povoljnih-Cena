import { expect, it } from "vitest";
import { boxQuantity, myGlsBoxQuantities } from "@/lib/courier/label-quantity";

it("counts all units in a consolidated parcel rather than SKU rows or stale defaults", () => {
  const packedItems = [2, 3].map((quantity, i) => ({ orderItemId: `i-${i}`, quantity, sku: `S-${i}`, name: "Article", barcode: null, categoryName: null, color1: null, color2: null, unitValue: 100 }));
  expect(boxQuantity({ packedQuantity: 1, packedItems })).toBe(5);
  expect(boxQuantity({ packedQuantity: 2 })).toBe(2);
  expect(() => boxQuantity({ packedQuantity: 0 })).toThrow();
  expect(() => boxQuantity({ packedQuantity: 1.5 })).toThrow();
});

it("keeps snapshot quantities tied to provider identities and leaves missing legacy values unknown", () => {
  expect(myGlsBoxQuantities({ myGlsPackageAssignments: [{ parcelNumber: 123, clientReference: "ORD-P1", packedQuantity: 2 }, { parcelNumber: 124 }] }))
    .toEqual([{ parcelNumber: "123", clientReference: "ORD-P1", quantity: 2 }]);
  expect(myGlsBoxQuantities(null)).toEqual([]);
});
