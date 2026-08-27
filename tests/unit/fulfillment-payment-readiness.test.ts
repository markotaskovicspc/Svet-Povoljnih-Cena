import { describe, expect, it } from "vitest";
import {
  assertFulfillmentPaymentReady,
  fulfillmentPaymentReadiness,
} from "@/lib/payments/fulfillment-readiness";

describe("fulfillment payment readiness", () => {
  it("blocks a pending bank transfer before picking, labels and courier calls", () => {
    const result = fulfillmentPaymentReadiness({
      purpose: "ORDER_DELIVERY",
      paymentMethod: "UPLATA_NA_RACUN",
      paymentStatuses: ["PENDING"],
    });

    expect(result).toEqual({
      ready: false,
      reason: "Uplata na račun još nije potvrđena.",
    });
    expect(() =>
      assertFulfillmentPaymentReady({
        orderNumber: "SPC-2026-000068",
        purpose: "ORDER_DELIVERY",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["PENDING"],
      }),
    ).toThrow(/SPC-2026-000068.*adresnicu.*Uplata na račun/);
  });

  it("allows a bank transfer only after it is fully marked paid", () => {
    expect(
      fulfillmentPaymentReadiness({
        purpose: "ORDER_DELIVERY",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["AUTHORIZED"],
      }).ready,
    ).toBe(false);
    expect(
      fulfillmentPaymentReadiness({
        purpose: "ORDER_DELIVERY",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["PAID"],
      }).ready,
    ).toBe(true);
  });

  it("keeps both cash-on-delivery methods eligible while payment is pending", () => {
    for (const paymentMethod of [
      "POUZECE_GOTOVINA",
      "POUZECE_KARTICA",
    ] as const) {
      expect(
        fulfillmentPaymentReadiness({
          purpose: "ORDER_DELIVERY",
          paymentMethod,
          paymentStatuses: ["PENDING"],
        }).ready,
      ).toBe(true);
    }
  });

  it("allows authorized online payments and replacement shipments", () => {
    expect(
      fulfillmentPaymentReadiness({
        purpose: "ORDER_DELIVERY",
        paymentMethod: "KARTICA",
        paymentStatuses: ["AUTHORIZED"],
      }).ready,
    ).toBe(true);
    expect(
      fulfillmentPaymentReadiness({
        purpose: "RECLAMATION_REPLACEMENT",
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: [],
      }).ready,
    ).toBe(true);
  });
});
