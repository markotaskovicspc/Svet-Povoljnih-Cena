import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderPrintHtmlPdf } from "@/lib/pdf/print-html";
import { renderXExpressLabelsHtml } from "@/lib/x-express/labels";

describe("X Express printable PDF", () => {
  it.each([1, 4, 5])("prints %i packages on A4 sheets without extra blank pages", async (count) => {
    const codes = Array.from({ length: count }, (_, index) => `AAA085030000${index + 1}`);
    const html = renderXExpressLabelsHtml({
      id: "pdf-label-shipment",
      trackingNo: codes[0],
      packageCount: count,
      providerParcelNumbers: codes,
      providerRouteCode: "BG-ZE-4",
      providerRouteName: null,
      rawCreateResponse: null,
      createdAt: new Date("2026-09-08T13:05:00Z"),
      order: {
        number: "SPC-PDF-QA",
        total: 0,
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "Петар",
        shipLastName: "Петровић",
        shipPhone: "0601234567",
        shipStreet: "Bulevar oslobođenja 10A",
        shipCity: "Novi Sad",
        shipPostalCode: "21000",
        notes: "Pozvati pre isporuke",
        items: [{ name: "Rabalux plafonjera", qty: count }],
      },
    });
    const buffer = await renderPrintHtmlPdf(html);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(Math.ceil(count / 4));
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 0);
      expect(page.getHeight()).toBeCloseTo(841.89, 0);
    }
  }, 60_000);
});
