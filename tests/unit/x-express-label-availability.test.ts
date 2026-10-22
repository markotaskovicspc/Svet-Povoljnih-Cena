import { describe, expect, it } from "vitest";
import { isXExpressLabelAvailable, usableXExpressLabelWhere } from "@/lib/x-express/label-availability";

describe("existing X Express label availability", () => {
  it.each(["CREATED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "RETURNED", "FAILED"])("retains an accepted label after status becomes %s", status => {
    expect(isXExpressLabelAvailable({ status, trackingNo: "AAA0850303030", providerShipmentId: "provider-id" })).toBe(true);
  });
  it("keeps failed, unaccepted preparations and missing tracking codes unavailable", () => {
    expect(isXExpressLabelAvailable({ status: "FAILED", trackingNo: "AAA0850303030", providerShipmentId: null })).toBe(false);
    expect(isXExpressLabelAvailable({ status: "DELIVERED", trackingNo: null, providerShipmentId: "provider-id" })).toBe(false);
  });
  it("applies the same acceptance rule to batch label downloads", () => {
    expect(usableXExpressLabelWhere()).toEqual({ trackingNo: { not: null }, OR: [{ status: { not: "FAILED" } }, { providerShipmentId: { not: null } }] });
  });
});
