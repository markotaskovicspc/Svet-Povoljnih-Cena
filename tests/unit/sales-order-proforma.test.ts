import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildVpProformaPdf } from "@/lib/admin/sales-order-proforma.server";

const order = {
  channel: "VP",
  number: "VP-2026-000001",
  shipCompanyName: "Kupac DOO",
  shipPib: "123456789",
  shipFirstName: "",
  shipLastName: "",
  shipStreet: "Primer 1",
  shipPostalCode: "11000",
  shipCity: "Beograd",
  shipCountry: "RS",
  customer: { registrationNumber: "87654321" },
  priceList: { currency: "RSD" },
  items: [
    {
      sku: "ART-1",
      name: "Artikal",
      shortNameSnapshot: "Artikal",
      qty: 2,
      unitPriceSale: 1_200,
    },
  ],
};

describe("VP proforma PDF", () => {
  it("creates a printable PDF for a complete VP order", () => {
    const pdf = buildVpProformaPdf(order as never);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("rejects non-VP orders and incomplete company data", () => {
    expect(() =>
      buildVpProformaPdf({ ...order, channel: "MP" } as never),
    ).toThrow("samo za veleprodajnu");
    expect(() =>
      buildVpProformaPdf({ ...order, shipPib: "" } as never),
    ).toThrow("naziv firme i PIB");
  });
});
