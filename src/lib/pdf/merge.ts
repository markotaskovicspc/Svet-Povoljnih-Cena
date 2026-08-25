import { PDFDocument } from "pdf-lib";

export async function mergePdfDocuments(
  documents: readonly (Uint8Array | ArrayBuffer)[],
  metadata?: { title?: string; author?: string },
) {
  if (!documents.length) {
    throw new Error("Nema PDF dokumenata za spajanje.");
  }

  const merged = await PDFDocument.create();
  for (const bytes of documents) {
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  if (!merged.getPageCount()) {
    throw new Error("PDF dokumenti nemaju nijednu stranicu.");
  }

  if (metadata?.title) merged.setTitle(metadata.title);
  if (metadata?.author) merged.setAuthor(metadata.author);
  merged.setProducer("Svet povoljnih cena ERP");
  return Buffer.from(await merged.save());
}
