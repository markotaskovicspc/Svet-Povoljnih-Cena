import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { addMyGlsProductBarcodes, MyGlsProductBarcodeLayoutError } from "@/lib/mygls/product-barcode";
import { readMyGlsPageText } from "@/lib/mygls/label-redaction";
import { myGlsArticleContent } from "@/lib/mygls/article-content";

async function labelPdf(contents: string[], includeHeadings = true) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let offset = 0; offset < contents.length; offset += 4) {
    const page = doc.addPage([841.89, 595.276]);
    contents.slice(offset, offset + 4).forEach((content, index) => {
      const x = 199 + (index % 2) * 398;
      const y = 389.0338 - Math.floor(index / 2) * 290;
      if (includeHeadings) {
        page.drawText("Primalac:", { x, y: y + 163, font, size: 8 });
        page.drawText("Posiljalac:", { x: x + 63, y, font, size: 8 });
      }
      page.drawText(content, { x, y: y + 34.2842, font, size: 11, lineHeight: 11, maxWidth: 215 });
    });
  }
  return doc.save();
}

describe("GLS article barcodes", () => {
  it("decorates each label independently across sheets, preserves text and is idempotent", async () => {
    const contents = [
      "Sto / Sifra: 210027\n/ EAN: 0012345678905",
      "Stolica / Sifra: 110081 / EAN: 8601234567890",
      "Artikal bez EAN / Sifra: 0003",
      "Lampa / Sifra: 0004 / EAN: 5998250398767",
      "Sto / Sifra: 210027 / EAN: 0012345678905",
    ];
    const original = await labelPdf(contents);
    const result = await addMyGlsProductBarcodes(original);
    expect(result.barcodeCount).toBe(4);
    const before = await PDFDocument.load(original);
    const after = await PDFDocument.load(result.bytes);
    expect(after.getPageCount()).toBe(2);
    expect(after.getPages().map((page) => readMyGlsPageText(after, page).map((b) => b.text)))
      .toEqual(before.getPages().map((page) => readMyGlsPageText(before, page).map((b) => b.text)));
    const second = await addMyGlsProductBarcodes(result.bytes);
    expect(second.barcodeCount).toBe(0);
    expect(second.bytes).toEqual(result.bytes);
  });

  it("does not manufacture an EAN for a legacy label or a missing product barcode", async () => {
    const original = await labelPdf(["Komjuter sto LOFT", "Sto / Sifra: 210027"]);
    const result = await addMyGlsProductBarcodes(original);
    expect(result.barcodeCount).toBe(0);
    expect(result.bytes).toEqual(Buffer.from(original));
  });

  it("keeps long names within the content area and supports catalogue alphanumeric barcodes", async () => {
    const content = myGlsArticleContent({ name: "Veoma dugacak naziv ".repeat(20), sku: "000123", product: { barcode: "ABC-001234" } });
    expect(content).toContain("... / Sifra: 000123 / EAN: ABC-001234");
    const result = await addMyGlsProductBarcodes(await labelPdf([content]));
    expect(result.barcodeCount).toBe(1);
  });

  it("rejects an unknown provider layout instead of overlapping courier data", async () => {
    await expect(addMyGlsProductBarcodes(await labelPdf(["Sto / EAN: 0012345678905"], false)))
      .rejects.toThrow("raspored adresnice nije prepoznat");
  });

  it("fits the actual September 23 GLS baselines below the privacy notice", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([841.89, 595.276]);
    for (const [x, senderY, contentY, code] of [
      [199, 389.0338, 427.8444, "AN1TEBG5XL"],
      [597, 389.0338, 426.0338, "8605078600262"],
      [197, 89.03381, 126.0338, "8605078600262"],
    ] as const) {
      page.drawText("Primalac:", { x, y: senderY + 163, font, size: 8 });
      page.drawText("Posiljalac:", { x: x + 63, y: senderY, font, size: 8 });
      page.drawText("Politika privatnosti", { x, y: senderY + 73.8106, font, size: 5 });
      page.drawText(`Artikal / Sifra: 110083 / EAN: ${code}`, { x, y: contentY, font, size: 6 });
    }
    const original = await doc.save();
    const result = await addMyGlsProductBarcodes(original);
    expect(result.barcodeCount).toBe(3);
    const before = await PDFDocument.load(original);
    const after = await PDFDocument.load(result.bytes);
    expect(readMyGlsPageText(after, after.getPage(0)).map((b) => b.text))
      .toEqual(readMyGlsPageText(before, before.getPage(0)).map((b) => b.text));
    expect((await addMyGlsProductBarcodes(result.bytes)).bytes).toEqual(result.bytes);
  });

  it("rejects decoration when provider text leaves no safe space", async () => {
    const doc = await PDFDocument.load(await labelPdf(["Sto / EAN: 0012345678905"]));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(0).drawText("Provider notice", { x: 199, y: 440, font, size: 8 });
    await expect(addMyGlsProductBarcodes(await doc.save()))
      .rejects.toBeInstanceOf(MyGlsProductBarcodeLayoutError);
  });
});
