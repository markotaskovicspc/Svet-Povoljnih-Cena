import { describe, expect, it } from "vitest";
import {
  resolveDocumentBuyerAddress,
  resolveOrderDocumentBuyerAddress,
} from "@/lib/document-buyer";

const shippingConsumer = {
  id: "shipping-consumer",
  firstName: "Darko",
  lastName: "Stanić",
};
const billingConsumer = {
  id: "billing-consumer",
  firstName: "Iva",
  lastName: "Stanić",
};
const shippingBusiness = {
  ...shippingConsumer,
  id: "shipping-business",
  companyName: "DSF DOO",
  pib: "106986493",
};
const billingBusiness = {
  ...billingConsumer,
  id: "billing-business",
  companyName: "Kupac d.o.o.",
  pib: "109876543",
};

describe("document buyer selection", () => {
  it.each([
    {
      label: "ordinary billing address for a consumer",
      shipping: shippingConsumer,
      billing: billingConsumer,
      expected: "billing-consumer",
    },
    {
      label: "business billing address",
      shipping: shippingConsumer,
      billing: billingBusiness,
      expected: "billing-business",
    },
    {
      label: "business shipping address over personal billing",
      shipping: shippingBusiness,
      billing: billingConsumer,
      expected: "shipping-business",
    },
    {
      label: "business billing address when both addresses are businesses",
      shipping: shippingBusiness,
      billing: billingBusiness,
      expected: "billing-business",
    },
  ])("selects $label", ({ shipping, billing, expected }) => {
    expect(resolveDocumentBuyerAddress(shipping, billing).id).toBe(expected);
  });

  it("prefers a complete legal identity over a partial legacy identity", () => {
    expect(
      resolveDocumentBuyerAddress(shippingBusiness, {
        ...billingConsumer,
        companyName: "Nepotpuna firma",
      }).id,
    ).toBe("shipping-business");
  });

  it("resolves the reported order shape to the legal shipping buyer", () => {
    expect(
      resolveOrderDocumentBuyerAddress({
        billingSameAsShipping: false,
        shipFirstName: "Darko",
        shipLastName: "Stanić",
        shipCompanyName: "DSF DOO",
        shipPib: "106986493",
        shipStreet: "Tihomira Vuksanovića 45",
        shipPostalCode: "34000",
        shipCity: "Kragujevac",
        billFirstName: "Iva",
        billLastName: "Stanić",
        billCompanyName: null,
        billPib: null,
        billStreet: "Industrijska 17",
        billPostalCode: "34000",
        billCity: "Kragujevac",
      }),
    ).toMatchObject({
      source: "shipping",
      companyName: "DSF DOO",
      pib: "106986493",
      street: "Tihomira Vuksanovića 45",
    });
  });
});
