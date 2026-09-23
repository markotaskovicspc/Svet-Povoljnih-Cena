import JsBarcode from "jsbarcode";
import { PDFDocument, PDFName, rgb } from "pdf-lib";
import { readMyGlsPageText } from "./label-redaction";

const MARKER = PDFName.of("SPCArticleBarcodesV1");

export class MyGlsProductBarcodeLayoutError extends Error {}

/**
 * Decorate the provider's content area only. Match each article using the EAN
 * printed in that very label, never response order or a neighbouring package.
 * This runs at download time: a layout error cannot re-book a courier shipment.
 */
export async function addMyGlsProductBarcodes(source: Uint8Array) {
  const document = await PDFDocument.load(source, { updateMetadata: false });
  let barcodeCount = 0;
  for (const page of document.getPages()) {
    if (page.node.has(MARKER)) continue;
    const blocks = readMyGlsPageText(document, page);
    const senders = blocks.filter((block) =>
      /^po[sš]iljalac\s*:/iu.test(block.text.trim()),
    );
    let pageCount = 0;
    for (const sender of senders) {
      // Verified MyGLS A4_2x2 layout: content column is 63pt left of sender.
      // Locate the recipient heading too, so a different layout fails closed.
      const recipient = blocks.find((block) =>
        /^primalac\s*:/iu.test(block.text.trim()) &&
        Math.abs(block.x - (sender.x - 63)) < 2 &&
        Math.abs(block.y - sender.y - 163) < 3,
      );
      if (!recipient) continue;
      const contentBlocks = blocks.filter((block) =>
        Math.abs(block.x - recipient.x) < 2 &&
        block.y > sender.y + 5 && block.y < sender.y + 55,
      ).sort((a, b) => b.y - a.y);
      const content = contentBlocks.map((block) => block.text).join(" ");
      const match = content.match(/\bEAN:\s*([A-Za-z0-9][A-Za-z0-9._/\s-]*)\s*$/);
      if (!match) continue;
      const value = match[1]!.replace(/\s/g, "");
      const encoded: { encodings?: Array<{ data: string }> } = {};
      let valid = false;
      JsBarcode(encoded, value, {
        format: "CODE128", displayValue: false,
        valid: (result) => { valid = result; },
      });
      const bits = valid ? encoded.encodings?.map((part) => part.data).join("") : null;
      if (!bits) throw new MyGlsProductBarcodeLayoutError("Barkod artikla nije moguće prikazati na GLS adresnici.");
      const x = recipient.x;
      // GLS varies the article baseline with its chosen font/layout. Keep ten
      // points above the actual text, while staying inside the verified slot
      // and below any provider text (including the privacy notice).
      const y = Math.max(sender.y + 46, ...contentBlocks.map((block) => block.y + 10));
      const ceiling = Math.min(
        sender.y + 69,
        ...blocks
          .filter((block) => block.x >= x - 2 && block.x < x + 210 && block.y >= y)
          .map((block) => block.y - 5),
      );
      const height = Math.min(23, ceiling - y);
      const moduleWidth = Math.min(1.2, 210 / (bits.length + 20));
      if (moduleWidth < 0.7 || height < 18) {
        throw new MyGlsProductBarcodeLayoutError("GLS adresnica nema dovoljno mesta za čitljiv barkod artikla.");
      }
      // Ten-module quiet zones stay entirely inside the content column.
      page.drawRectangle({ x, y, width: (bits.length + 20) * moduleWidth, height, color: rgb(1, 1, 1) });
      for (let index = 0; index < bits.length; index += 1) {
        if (bits[index] === "1") page.drawRectangle({
          x: x + (index + 10) * moduleWidth, y, width: moduleWidth, height,
          color: rgb(0, 0, 0),
        });
      }
      barcodeCount += 1;
      pageCount += 1;
    }
    const expected = blocks.filter((block) => /\bEAN:/.test(block.text)).length;
    if (pageCount !== expected) {
      throw new MyGlsProductBarcodeLayoutError("GLS raspored adresnice nije prepoznat za dodavanje barkoda artikla.");
    }
    if (pageCount) page.node.set(MARKER, document.context.obj(true));
  }
  return {
    bytes: barcodeCount ? Buffer.from(await document.save()) : Buffer.from(source),
    barcodeCount,
  };
}
