import { describe, expect, it } from "vitest";
import {
  normalizeWebOrderShippingAddress,
  normalizeWebOrderShippingPhone,
  planWebOrderShippingEdit,
  shippingEditWaybillQuestion,
  type WebOrderShippingEditShipment,
} from "@/lib/admin/web-order-shipping";

function shipment(
  overrides: Partial<WebOrderShippingEditShipment> = {},
): WebOrderShippingEditShipment {
  return {
    id: "shipment-1",
    purpose: "ORDER_DELIVERY",
    status: "CREATED",
    provider: "MYGLS",
    providerShipmentId: "parcel-1",
    trackingNo: "tracking-1",
    ...overrides,
  };
}

describe("WEB order shipping contact editing", () => {
  it("normalizes an address and Serbian mobile formats", () => {
    expect(
      normalizeWebOrderShippingAddress({
        street: "  29. Novembra   11 ",
        city: " Leskovac ",
        postalCode: "16000",
      }),
    ).toEqual({
      street: "29. Novembra 11",
      city: "Leskovac",
      postalCode: "16000",
    });
    expect(normalizeWebOrderShippingPhone("+381 60 332 63 25")).toBe(
      "0603326325",
    );
    expect(normalizeWebOrderShippingPhone("00381-64-123-4567")).toBe(
      "0641234567",
    );
  });

  it("rejects invalid postal codes and phone numbers", () => {
    expect(() =>
      normalizeWebOrderShippingAddress({
        street: "Test 1",
        city: "Niš",
        postalCode: "1800",
      }),
    ).toThrow("5 cifara");
    expect(() => normalizeWebOrderShippingPhone("011123456")).toThrow(
      "mora početi sa 06",
    );
  });

  it("requires replacement for a created MyGLS waybill", () => {
    const plan = planWebOrderShippingEdit([shipment()]);
    expect(plan.kind).toBe("REPLACE_WAYBILLS");
    expect(shippingEditWaybillQuestion(plan)).toContain(
      "poništimo staru i napravimo novu",
    );
    if (plan.kind === "REPLACE_WAYBILLS") {
      expect(plan.manuallyCancelledXExpressShipments).toHaveLength(0);
    }
  });

  it("requires manual provider cancellation for an announced X Express waybill", () => {
    const plan = planWebOrderShippingEdit([
      shipment({ provider: "X_EXPRESS", providerShipmentId: "request-guid" }),
    ]);
    expect(plan.kind).toBe("REPLACE_WAYBILLS");
    if (plan.kind === "REPLACE_WAYBILLS") {
      expect(plan.manuallyCancelledXExpressShipments).toHaveLength(1);
    }
  });

  it("replaces a locally prepared X Express label without manual cancellation", () => {
    const plan = planWebOrderShippingEdit([
      shipment({ provider: "X_EXPRESS", providerShipmentId: null }),
    ]);
    expect(plan.kind).toBe("REPLACE_WAYBILLS");
    if (plan.kind === "REPLACE_WAYBILLS") {
      expect(plan.manuallyCancelledXExpressShipments).toHaveLength(0);
    }
  });

  it("blocks edits after courier pickup", () => {
    const plan = planWebOrderShippingEdit([
      shipment({ status: "IN_TRANSIT" }),
    ]);
    expect(plan.kind).toBe("BLOCKED");
    if (plan.kind === "BLOCKED") {
      expect(plan.reason).toContain("već preuzeta");
    }
  });
});
