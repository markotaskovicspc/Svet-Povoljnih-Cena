import { expect, it } from "vitest";
import { ananasInventoryPlan, ananasInventorySku, ANANAS_INVENTORY_START } from "@/lib/ananas/inventory-plan";
it("resolves legacy four-digit SKUs without changing current or nonnumeric SKUs", () => {
  expect(ananasInventorySku("1145")).toBe("110145");
  expect(ananasInventorySku("1019")).toBe("110019");
  expect(ananasInventorySku("110145")).toBe("110145");
  expect(ananasInventorySku("RAB-1145")).toBe("RAB-1145");
});
it("debits sales, credits refunds immediately, aggregates repeated SKUs and excludes services", () => {
  const items = [{ sku: "A", name: "Sto", quantity: 2 }, { sku: "A", name: "Sto", quantity: 3 }, { sku: "DOSTAVA", name: "Dostava", quantity: 1 }];
  expect(ananasInventoryPlan("SALE", items).lines).toEqual([{ sku: "A", qtyDelta: -5 }]);
  expect(ananasInventoryPlan("REFUND", items).lines).toEqual([{ sku: "A", qtyDelta: 5 }]);
  expect(ananasInventoryPlan("SALE", items).fingerprint).toBe(ananasInventoryPlan("SALE", [...items].reverse()).fingerprint);
  expect(ananasInventoryPlan("SALE", items).fingerprint).not.toBe(ananasInventoryPlan("REFUND", items).fingerprint);
  expect(ANANAS_INVENTORY_START).toBe("2025-05-31T22:00:00.000Z");
});
it("blocks missing SKUs and malformed quantities instead of silently skipping sold goods", () => {
  expect(() => ananasInventoryPlan("SALE", [{ sku: "", name: "Sto", quantity: 1 }])).toThrow(/šifru/);
  expect(() => ananasInventoryPlan("SALE", [{ sku: "A", name: "Sto", quantity: 1.5 }])).toThrow();
});
