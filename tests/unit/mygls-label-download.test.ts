import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";

const storage = vi.hoisted(() => ({ download: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: storage.from } }),
}));

import { downloadMyGlsLabelPdf } from "@/lib/mygls/labels";
import { redactMyGlsSenderContactPdf, readMyGlsPageText } from "@/lib/mygls/label-redaction";

async function pdf(unsupportedSecondPage = false) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([841.89, 595.276]);
  page.drawText("Primalac:", { x: 199, y: 552.0338, font, size: 8 });
  page.drawText("Posiljalac:", { x: 262, y: 389.0338, font, size: 8 });
  page.drawText("Marko Taskovic +381621112222", { x: 262, y: 350, font, size: 8 });
  page.drawText("Sto / EAN: 8605078600262", { x: 199, y: 426.0338, font, size: 6 });
  if (unsupportedSecondPage) {
    doc.addPage([841.89, 595.276])
      .drawText("Drugi artikal / EAN: 0012345678905", { x: 120, y: 400, font, size: 8 });
  }
  return Buffer.from(await doc.save());
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.from.mockReturnValue({ download: storage.download });
});
afterEach(() => vi.restoreAllMocks());

describe("MyGLS stored label download", () => {
  it("downloads and decorates the production article baseline", async () => {
    const bytes = await pdf();
    storage.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes)]), error: null });
    const downloaded = await downloadMyGlsLabelPdf("existing.pdf");
    const doc = await PDFDocument.load(downloaded);
    expect(doc.getPage(0).node.has(PDFName.of("SPCArticleBarcodesV1"))).toBe(true);
    expect(storage.download).toHaveBeenCalledExactlyOnceWith("existing.pdf");
    expect(storage.from).toHaveBeenCalledWith("shipment-labels");
  });

  it("returns the complete redacted provider PDF if a later page has an unknown layout", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bytes = await pdf(true);
    storage.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes)]), error: null });
    const downloaded = await downloadMyGlsLabelPdf("existing.pdf");
    expect(downloaded).toEqual((await redactMyGlsSenderContactPdf(bytes)).bytes);
    const doc = await PDFDocument.load(downloaded);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPages().some((page) => page.node.has(PDFName.of("SPCArticleBarcodesV1")))).toBe(false);
    expect(doc.getPages().flatMap((page) => readMyGlsPageText(doc, page)).map((b) => b.text).join(" "))
      .not.toContain("381621112222");
    expect(warn).toHaveBeenCalledExactlyOnceWith("[mygls-label] Article barcode omitted: unsupported label layout.");
  });

  it("does not hide private storage failures", async () => {
    storage.download.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    await expect(downloadMyGlsLabelPdf("existing.pdf")).rejects.toThrow("storage unavailable");
  });

  it("does not deliver a corrupt provider file", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["not a PDF"]), error: null });
    await expect(downloadMyGlsLabelPdf("existing.pdf")).rejects.toThrow();
  });
});
