import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPurchaseOrderPdf } from "@/lib/admin/po-pdf";

describe("purchase-order PDF", () => {
  it("builds a valid PDF attachment", () => {
    const pdf = buildPurchaseOrderPdf({
      number: "E2E-1/26",
      orderDate: new Date("2026-07-16T00:00:00Z"),
      currency: "RSD",
      freightCost: 1_500,
      totalPrice: 25_000,
      supplier: {
        name: "Test dobavljač",
        address: "Industrijska 1",
        city: "Beograd",
        country: "Srbija",
      },
      items: [
        { sku: "SKU-1", name: "Test stolica", qty: 2, purchasePrice: 5_000 },
        { sku: "SKU-2", name: "Test sto", qty: 1, purchasePrice: 15_000 },
      ],
    });
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pdf.length).toBeGreaterThan(1_000);
    if (process.env.PO_PDF_SAMPLE_PATH) {
      writeFileSync(process.env.PO_PDF_SAMPLE_PATH, pdf);
    }
  });
});
