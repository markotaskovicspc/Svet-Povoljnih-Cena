import { describe, expect, it } from "vitest";
import {
  adminPaymentMethodLabel,
  adminPaymentStatusLabel,
} from "@/lib/payments/admin-display";

describe("admin payment display", () => {
  it("shows bank transfers as waiting until a PAID attempt exists", () => {
    expect(
      adminPaymentStatusLabel({
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["PENDING"],
      }),
    ).toBe("Čeka uplatu");
    expect(
      adminPaymentStatusLabel({
        paymentMethod: "UPLATA_NA_RACUN",
        paymentStatuses: ["PAID"],
      }),
    ).toBe("Plaćeno");
  });

  it("does not describe cash on delivery as unpaid", () => {
    expect(
      adminPaymentStatusLabel({
        paymentMethod: "POUZECE_GOTOVINA",
        paymentStatuses: ["PENDING"],
      }),
    ).toBe("Plaća se kuriru");
    expect(adminPaymentMethodLabel("POUZECE_KARTICA")).toBe(
      "Pouzeće — kartica",
    );
  });

  it("shows successful electronic payment and refund states", () => {
    expect(
      adminPaymentStatusLabel({
        paymentMethod: "KARTICA",
        paymentStatuses: ["FAILED", "AUTHORIZED"],
      }),
    ).toBe("Autorizovano");
    expect(
      adminPaymentStatusLabel({
        paymentMethod: "IPS",
        paymentStatuses: ["PARTIAL_REFUND", "PAID"],
      }),
    ).toBe("Delimično refundirano");
    expect(
      adminPaymentStatusLabel({
        paymentMethod: "KARTICA",
        paymentStatuses: ["FAILED"],
      }),
    ).toBe("Neuspešno");
  });
});
