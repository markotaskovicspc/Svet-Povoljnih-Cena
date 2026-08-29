import { describe, expect, it } from "vitest";
import { planWebOrderPaymentMethodChange } from "@/lib/admin/web-order-payment";

const emptyAttempt = {
  status: "PENDING" as const,
  providerRef: null,
  paymentReference: null,
  redirectUrl: null,
  hasRawRequest: false,
  hasRawResponse: false,
};

describe("WEB order payment-method editing", () => {
  it("switches bank transfer to cash on delivery and changes supplier readiness", () => {
    expect(
      planWebOrderPaymentMethodChange({
        currentMethod: "UPLATA_NA_RACUN",
        nextMethod: "POUZECE_GOTOVINA",
        mixedRabaluxOrder: false,
        attempts: [emptyAttempt],
      }),
    ).toEqual({
      invalidatePendingAttempts: 1,
      supplierReadinessChanged: true,
      willBeCashOnDelivery: true,
    });
  });

  it("switches between both cash-on-delivery variants without changing readiness", () => {
    expect(
      planWebOrderPaymentMethodChange({
        currentMethod: "POUZECE_GOTOVINA",
        nextMethod: "POUZECE_KARTICA",
        mixedRabaluxOrder: false,
        attempts: [emptyAttempt],
      }),
    ).toMatchObject({
      supplierReadinessChanged: false,
      willBeCashOnDelivery: true,
    });
  });

  it("allows a failed online attempt to remain as historical evidence", () => {
    expect(() =>
      planWebOrderPaymentMethodChange({
        currentMethod: "KARTICA",
        nextMethod: "UPLATA_NA_RACUN",
        mixedRabaluxOrder: false,
        attempts: [
          {
            ...emptyAttempt,
            status: "FAILED",
            providerRef: "failed-provider-ref",
            hasRawResponse: true,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects the current method and methods requiring a new online authorization", () => {
    expect(() =>
      planWebOrderPaymentMethodChange({
        currentMethod: "POUZECE_GOTOVINA",
        nextMethod: "POUZECE_GOTOVINA",
        mixedRabaluxOrder: false,
        attempts: [emptyAttempt],
      }),
    ).toThrow("već aktivan");
    expect(() =>
      planWebOrderPaymentMethodChange({
        currentMethod: "POUZECE_GOTOVINA",
        nextMethod: "KARTICA",
        mixedRabaluxOrder: false,
        attempts: [emptyAttempt],
      }),
    ).toThrow("samo uplata na račun ili plaćanje pouzećem");
  });

  it("blocks mixed Rabalux COD", () => {
    expect(() =>
      planWebOrderPaymentMethodChange({
        currentMethod: "UPLATA_NA_RACUN",
        nextMethod: "POUZECE_GOTOVINA",
        mixedRabaluxOrder: true,
        attempts: [emptyAttempt],
      }),
    ).toThrow("Mešovita DC + Rabalux");
  });

  it("blocks settled money and an active external payment session", () => {
    expect(() =>
      planWebOrderPaymentMethodChange({
        currentMethod: "KARTICA",
        nextMethod: "UPLATA_NA_RACUN",
        mixedRabaluxOrder: false,
        attempts: [{ ...emptyAttempt, status: "PAID" }],
      }),
    ).toThrow("naplaćeno");
    expect(() =>
      planWebOrderPaymentMethodChange({
        currentMethod: "KARTICA",
        nextMethod: "UPLATA_NA_RACUN",
        mixedRabaluxOrder: false,
        attempts: [{ ...emptyAttempt, redirectUrl: "https://pay.example/1" }],
      }),
    ).toThrow("Online plaćanje je već pokrenuto");
  });
});
