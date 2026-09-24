import { describe, expect, it } from "vitest";
import { decodePDFRawStream, PDFDocument, PDFRawStream, StandardFonts } from "pdf-lib";
import { enlargeMyGlsArticleText, packMyGlsLabels } from "@/lib/mygls/print-layout";
import { addMyGlsProductBarcodes } from "@/lib/mygls/product-barcode";
import { readMyGlsPageText } from "@/lib/mygls/label-redaction";

async function providerPdf(count: number, name = "Trpezarijska stolica ELEGANCE SEAT") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let offset = 0; offset < count; offset += 4) {
    const page = doc.addPage([841.89, 595.276]);
    for (let i = 0; i < Math.min(4, count - offset); i++) {
      const x = 199 + (i % 2) * 398;
      const y = 389.0338 - Math.floor(i / 2) * 300;
      page.drawText("Primalac:", { x, y: y + 163, size: 8, font });
      page.drawText("Posiljalac:", { x: x + 63, y, size: 8, font });
      page.drawText("Politika privatnosti", { x, y: y + 73.8106, size: 6, font });
      page.drawText(`${name} / Sifra: 110086 / EAN: 8605079400038`, { x, y: y + 38.8106, size: 4, font });
      page.drawText(`TRACK-${offset + i}`, { x: x - 170, y: y + 100, size: 14, font });
    }
  }
  return doc.save();
}

describe("GLS print layout", () => {
  it("reflows tiny product text without duplicating identifiers and still adds every product barcode", async () => {
    const before = await providerPdf(5);
    const result = await enlargeMyGlsArticleText(before);
    const doc = await PDFDocument.load(result);
    const blocks = doc.getPages().flatMap((p) => readMyGlsPageText(doc, p));
    expect(blocks.filter((b) => b.text.includes("EAN:"))).toHaveLength(5);
    expect(blocks.filter((b) => b.text.startsWith("Trpezarijska stolica"))).toHaveLength(5);
    expect((await addMyGlsProductBarcodes(result)).barcodeCount).toBe(5);
    expect(await enlargeMyGlsArticleText(result)).toEqual(result);
    expect(blocks.filter((b) => b.text.startsWith("TRACK-"))).toHaveLength(5);
    for (const page of doc.getPages()) {
      const streams = page.node.Contents()!;
      const stream = doc.context.lookup("size" in streams ? streams.get(streams.size() - 1) : streams);
      expect(stream).toBeInstanceOf(PDFRawStream);
      const operators = Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString();
      expect(operators).toMatch(/ 11 Tf/);
    }
  });

  it("packs ten sparse shipment PDFs into three portrait sheets and counts across order shipments", async () => {
    const bytes = await providerPdf(1);
    const result = await packMyGlsLabels(Array.from({ length: 10 }, (_, i) => ({
      bytes, packageCount: 1, groupKey: i < 3 ? "same-order" : `order-${i}`,
    })), "Test batch");
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().every((p) => p.getWidth() === 595.276 && p.getHeight() === 841.89)).toBe(true);
    const counters = doc.getPages().flatMap((p) => readMyGlsPageText(doc, p)).map((b) => b.text);
    expect(counters.slice(0, 3)).toEqual(["Paket 1/3", "Paket 2/3", "Paket 3/3"]);
    expect(counters).toHaveLength(10);
    expect(doc.catalog.getOrCreateViewerPreferences().getPrintScaling()).toBe("None");
  });

  it("fills sheets across a five-package shipment boundary without dropping or duplicating labels", async () => {
    const result = await packMyGlsLabels([
      { bytes: await providerPdf(5), packageCount: 5, groupKey: "a" },
      { bytes: await providerPdf(3), packageCount: 3, groupKey: "b" },
    ], "Eight labels");
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(2);
    const counts = doc.getPages().map((p) => readMyGlsPageText(doc, p).map((b) => b.text));
    expect(counts).toEqual([
      ["Paket 1/5", "Paket 2/5", "Paket 3/5", "Paket 4/5"],
      ["Paket 5/5", "Paket 1/3", "Paket 2/3", "Paket 3/3"],
    ]);
  });

  it("rejects mismatched package counts and unknown layouts before producing a printout", async () => {
    await expect(packMyGlsLabels([{ bytes: await providerPdf(1), packageCount: 2, groupKey: "a" }], "Test"))
      .rejects.toThrow("1 od 2");
    const doc = await PDFDocument.load(await providerPdf(1));
    doc.getPage(0).setSize(595.276, 841.89);
    await expect(packMyGlsLabels([{ bytes: await doc.save(), packageCount: 1, groupKey: "a" }], "Test"))
      .rejects.toThrow("format adresnice nije prepoznat");
  });
});
