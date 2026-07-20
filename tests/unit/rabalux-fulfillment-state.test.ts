import { describe, expect, it } from "vitest";
import {
  canConfirmSupplierFulfillment,
  canResendSupplierOrder,
  canSendSupplierOrder,
} from "@/lib/rabalux/fulfillment-state";

describe("supplier fulfillment state machine", () => {
  it("allows initial or retry sends without reopening terminal states", () => {
    expect(canSendSupplierOrder("PENDING")).toBe(true);
    expect(canSendSupplierOrder("FAILED")).toBe(true);
    expect(canSendSupplierOrder("SENT")).toBe(true);
    expect(canSendSupplierOrder("CONFIRMED")).toBe(false);
    expect(canSendSupplierOrder("PICKUP_READY")).toBe(false);
    expect(canSendSupplierOrder("CANCELLED")).toBe(false);
    expect(canSendSupplierOrder("COMPLETED")).toBe(false);
  });

  it("confirms only a sent fulfillment and keeps confirmation idempotent", () => {
    expect(canConfirmSupplierFulfillment("SENT")).toBe(true);
    expect(canConfirmSupplierFulfillment("CONFIRMED")).toBe(true);
    expect(canConfirmSupplierFulfillment("PENDING")).toBe(false);
    expect(canConfirmSupplierFulfillment("FAILED")).toBe(false);
    expect(canConfirmSupplierFulfillment("PICKUP_READY")).toBe(false);
    expect(canConfirmSupplierFulfillment("COMPLETED")).toBe(false);
  });

  it("permits a deliberate resend only after send or failure", () => {
    expect(canResendSupplierOrder("SENT")).toBe(true);
    expect(canResendSupplierOrder("FAILED")).toBe(true);
    expect(canResendSupplierOrder("PENDING")).toBe(false);
    expect(canResendSupplierOrder("CONFIRMED")).toBe(false);
    expect(canResendSupplierOrder("CANCELLED")).toBe(false);
    expect(canResendSupplierOrder("COMPLETED")).toBe(false);
  });
});
