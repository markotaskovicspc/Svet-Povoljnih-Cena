import { describe, expect, it } from "vitest";
import {
  keepsReturnedOrder,
  orderStatusFor,
  orderStatusForEvent,
} from "@/lib/courier/order-transition";

describe("courier order transition", () => {
  it("marks an X Express return in progress as a returned order", () => {
    for (const code of ["RETURNING", "RET_ASSIGNED", "REVERSE_RETURN", "reverse_returning"]) {
      expect(orderStatusForEvent("X_EXPRESS", { status: "IN_TRANSIT", providerStatusCode: code })).toBe("VRACENO");
    }
  });

  it("keeps ordinary transit scans as in delivery", () => {
    expect(orderStatusForEvent("X_EXPRESS", { status: "IN_TRANSIT", providerStatusCode: "IN_HUB" })).toBe("U_ISPORUCI");
    expect(orderStatusForEvent("MYGLS", { status: "IN_TRANSIT", providerStatusCode: "RETURNING" })).toBe("U_ISPORUCI");
    expect(orderStatusForEvent(null, { status: "IN_TRANSIT", providerStatusCode: "RETURNING" })).toBe("U_ISPORUCI");
  });

  it("leaves the other shipment statuses unchanged", () => {
    expect(orderStatusFor("DELIVERED")).toBe("ISPORUCENO");
    expect(orderStatusFor("RETURNED")).toBe("VRACENO");
    expect(orderStatusFor("FAILED")).toBeNull();
    expect(orderStatusForEvent("X_EXPRESS", { status: "DELIVERED", providerStatusCode: "DELIVERED" })).toBe("ISPORUCENO");
  });

  it("does not reopen a returned order on later transit scans", () => {
    expect(keepsReturnedOrder("VRACENO", "U_ISPORUCI")).toBe(true);
    expect(keepsReturnedOrder("VRACENO", "SPREMNO_ZA_ISPORUKU")).toBe(true);
    expect(keepsReturnedOrder("VRACENO", "ISPORUCENO")).toBe(false);
    expect(keepsReturnedOrder("U_ISPORUCI", "U_ISPORUCI")).toBe(false);
  });
});
