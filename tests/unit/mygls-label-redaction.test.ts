import { describe, expect, it } from "vitest";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import { redactMyGlsSenderContactPdf } from "@/lib/mygls/label-redaction";

const CONTACT = "Marko Taskovic +381621112222";

describe("MyGLS sender contact redaction", () => {
  it("removes only the obsolete contact in the sender block", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([841.89, 595.276]);
    const font = await source.embedFont(StandardFonts.Helvetica);

    page.drawText("Primalac:", { x: 199, y: 552, size: 8, font });
    page.drawText(CONTACT, { x: 199, y: 484, size: 10, font });
    page.drawText("Posiljalac:", { x: 262, y: 389, size: 8, font });
    page.drawText(CONTACT, { x: 262, y: 333, size: 10, font });

    const result = await redactMyGlsSenderContactPdf(await source.save());
    expect(result.redactedCount).toBe(1);

    const text = await decodedContent(result.bytes);
    expect(count(text, Buffer.from(CONTACT).toString("hex").toUpperCase())).toBe(1);

    const secondPass = await redactMyGlsSenderContactPdf(result.bytes);
    expect(secondPass.redactedCount).toBe(0);
    expect(secondPass.bytes).toEqual(result.bytes);
  });

  it("does not alter a PDF without the obsolete sender contact", async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const bytes = Buffer.from(await source.save());

    const result = await redactMyGlsSenderContactPdf(bytes);
    expect(result).toEqual({ bytes, redactedCount: 0 });
  });
});

async function decodedContent(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  return document
    .getPages()
    .flatMap((page) => {
      const contents = page.node.Contents();
      if (!contents) return [];
      const values = contents instanceof PDFArray
        ? Array.from({ length: contents.size() }, (_, index) => contents.get(index))
        : [contents];
      return values.map((value) => {
        const stream = document.context.lookup(value);
        if (!(stream instanceof PDFRawStream)) return "";
        return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      });
    })
    .join("\n");
}

function count(value: string, needle: string) {
  return value.split(`<${needle}>`).length - 1;
}
