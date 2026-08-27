import { describe, expect, it } from "vitest";
import {
  normalizeOrderItemIds,
  readShipmentAssignment,
  sameShipmentAssignment,
  splitAmountByWeights,
  withShipmentAssignment,
} from "@/lib/courier/shipment-assignment";

describe("courier shipment assignments", () => {
  it("stores a stable subset of order lines beside the provider response", () => {
    const raw = withShipmentAssignment(
      { tracking: "GLS-1" },
      {
        orderItemIds: ["line-b", "line-a", "line-b"],
        codAmount: 3499,
        supplierFulfillmentId: "ful-rabalux",
      },
    );

    expect(raw).toMatchObject({
      tracking: "GLS-1",
      assignment: {
        orderItemIds: ["line-a", "line-b"],
        codAmount: 3499,
        supplierFulfillmentId: "ful-rabalux",
      },
    });
    expect(readShipmentAssignment(raw)).toEqual({
      orderItemIds: ["line-a", "line-b"],
      codAmount: 3499,
      supplierFulfillmentId: "ful-rabalux",
    });
    expect(sameShipmentAssignment(raw, ["line-b", "line-a"])).toBe(true);
    expect(sameShipmentAssignment(raw, ["line-a"])).toBe(false);
  });

  it("keeps legacy provider payloads unassigned so they can mean the full order", () => {
    expect(readShipmentAssignment({ legacy: true })).toBeNull();
    expect(normalizeOrderItemIds([" b ", "a", "a", ""])).toEqual([
      "a",
      "b",
    ]);
  });

  it("splits mixed-order COD exactly once across X Express and MyGLS", () => {
    const split = splitAmountByWeights(10_000, [
      { key: "X_EXPRESS", weight: 3_000 },
      { key: "MYGLS", weight: 7_000 },
    ]);

    expect(split.get("X_EXPRESS")).toBe(3_000);
    expect(split.get("MYGLS")).toBe(7_000);
    expect([...split.values()].reduce((sum, amount) => sum + amount, 0)).toBe(
      10_000,
    );
  });

  it("puts the rounding remainder on the final provider group", () => {
    const split = splitAmountByWeights(100, [
      { key: "X_EXPRESS", weight: 1 },
      { key: "MYGLS", weight: 2 },
    ]);

    expect(split.get("X_EXPRESS")).toBe(33.33);
    expect(split.get("MYGLS")).toBe(66.67);
  });
});
