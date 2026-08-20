import { describe, expect, it } from "vitest";
import {
  normalizeOrderItemIds,
  readShipmentAssignment,
  sameShipmentAssignment,
  withShipmentAssignment,
} from "@/lib/courier/shipment-assignment";

describe("courier shipment assignments", () => {
  it("stores a stable subset of order lines beside the provider response", () => {
    const raw = withShipmentAssignment(
      { tracking: "GLS-1" },
      { orderItemIds: ["line-b", "line-a", "line-b"], codAmount: 3499 },
    );

    expect(raw).toMatchObject({
      tracking: "GLS-1",
      assignment: {
        orderItemIds: ["line-a", "line-b"],
        codAmount: 3499,
      },
    });
    expect(readShipmentAssignment(raw)).toEqual({
      orderItemIds: ["line-a", "line-b"],
      codAmount: 3499,
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
});
