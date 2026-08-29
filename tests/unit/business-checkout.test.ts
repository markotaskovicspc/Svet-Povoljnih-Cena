import { describe, expect, it } from "vitest";
import {
  checkoutBusinessIdentityMatchesOrder,
  missingBusinessAddressFields,
  shouldRestoreBusinessBuyerType,
} from "@/lib/checkout/business-policy";
import { createOrderSchema } from "@/lib/checkout/order-schema";

describe("checkout for a business buyer", () => {
  it("requires both company name and PIB when pravno lice is selected", () => {
    expect(
      missingBusinessAddressFields({ liceType: "pravno", pib: "109876543" }),
    ).toEqual(["companyName"]);
    expect(
      missingBusinessAddressFields({
        liceType: "pravno",
        companyName: "Kupac d.o.o.",
      }),
    ).toEqual(["pib"]);
    expect(
      missingBusinessAddressFields({
        liceType: "pravno",
        companyName: "Kupac d.o.o.",
        pib: "109876543",
      }),
    ).toEqual([]);

    const parsed = createOrderSchema.safeParse({
      guestEmail: "kupac@example.test",
      lines: [{ sku: "TEST-1", qty: 1 }],
      shipping: {
        liceType: "pravno",
        firstName: "Test",
        lastName: "Kupac",
        phone: "0601234567",
        street: "Test ulica 1",
        city: "Beograd",
        postalCode: "11000",
        country: "RS",
        pib: "109876543",
      },
      billingSameAsShipping: true,
      shippingMethod: "KURIR",
      paymentMethod: "UPLATA_NA_RACUN",
      consent: true,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["shipping", "companyName"],
        message: "Naziv firme je obavezan za pravno lice.",
      }),
    );
  });

  it("accepts cash on delivery for a business checkout", () => {
    const parsed = createOrderSchema.safeParse({
      guestEmail: "kupac@example.test",
      lines: [{ sku: "TEST-1", qty: 1 }],
      shipping: {
        liceType: "pravno" as const,
        firstName: "Test",
        lastName: "Kupac",
        phone: "0601234567",
        street: "Test ulica 1",
        city: "Beograd",
        postalCode: "11000",
        country: "RS",
        companyName: "Kupac d.o.o.",
        pib: "109876543",
      },
      billingSameAsShipping: true,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      consent: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses to reuse a converted checkout session with stale buyer data", () => {
    const input = {
      shipping: {
        liceType: "pravno" as const,
        companyName: "Kupac d.o.o.",
        pib: "109876543",
      },
      paymentMethod: "UPLATA_NA_RACUN",
    };
    const physicalCodOrder = {
      paymentMethod: "POUZECE_GOTOVINA",
      shipCompanyName: null,
      shipPib: null,
      billCompanyName: null,
      billPib: null,
    };

    expect(checkoutBusinessIdentityMatchesOrder(input, physicalCodOrder)).toBe(
      false,
    );
    expect(
      checkoutBusinessIdentityMatchesOrder(input, {
        ...physicalCodOrder,
        paymentMethod: "UPLATA_NA_RACUN",
        shipCompanyName: "Kupac d.o.o.",
        shipPib: "109876543",
      }),
    ).toBe(true);
  });

  it("restores a remembered business buyer over the physical default", () => {
    expect(
      shouldRestoreBusinessBuyerType({
        current: "fizicko",
        remembered: "pravno",
        dirty: false,
      }),
    ).toBe(true);
    expect(
      shouldRestoreBusinessBuyerType({
        current: "fizicko",
        remembered: "pravno",
        dirty: true,
      }),
    ).toBe(false);
  });
});
