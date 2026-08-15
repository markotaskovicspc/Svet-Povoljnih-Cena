import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import {
  buildGuaranteePdf,
  GUARANTEE_TERM_TEXT,
  guaranteeItemsForOrder,
} from "@/lib/email/guarantee-pdf";

describe("guarantee PDF", () => {
  it("uses the one-year term stated in the client comments", () => {
    expect(GUARANTEE_TERM_TEXT).toBe("1 (jedna) godina");
  });

  it("keeps every non-Rabalux item and excludes Rabalux", () => {
    expect(
      guaranteeItemsForOrder([
        orderItem("SPC-1", "SPC"),
        orderItem("RAB-1", "RABALUX"),
        orderItem("OWN-1"),
      ]).map((item) => item.sku),
    ).toEqual(["SPC-1", "OWN-1"]);
  });

  it("renders the supplied one-page layout as a valid PDF image page", async () => {
    const pdf = await buildGuaranteePdf({
      number: "SPC-2026-0001",
      createdAt: new Date("2026-08-15T10:00:00.000Z"),
      items: [
        {
          sku: "100001",
          name: "Test proizvod",
          qty: 2,
          categoryName: "Baštenski nameštaj",
          supplierIntegrationKey: "SPC",
        },
      ],
    });

    expect(pdf.subarray(0, 8).toString("binary")).toBe("%PDF-1.4");
    expect(pdf.length).toBeGreaterThan(50_000);
    expect(pdf.toString("binary")).toContain("/Count 1");

    if (process.env.GUARANTEE_PDF_SAMPLE_PATH) {
      await writeFile(process.env.GUARANTEE_PDF_SAMPLE_PATH, pdf);
    }
  });
});

function orderItem(sku: string, supplierIntegrationKey?: string) {
  return {
    sku,
    name: `Artikal ${sku}`,
    qty: 1,
    unitPriceFull: 100,
    unitPriceSale: 100,
    categoryName: "Kategorija",
    supplierIntegrationKey,
  };
}
