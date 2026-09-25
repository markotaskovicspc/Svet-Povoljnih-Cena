import { degrees, PDFDocument, PDFName, PrintScaling, StandardFonts, type PDFFont } from "pdf-lib";
import { readMyGlsPageText, removeMyGlsPageText } from "./label-redaction";

const ARTICLE_MARKER = PDFName.of("SPCReadableArticleV1");

export class MyGlsPrintLayoutError extends Error {}

/** Recognize only the verified provider A4_2x2 layout, before changing it. */
function labelSlots(document: PDFDocument, page: ReturnType<PDFDocument["getPage"]>) {
  if (Math.abs(page.getWidth() - 841.89) > 2 || Math.abs(page.getHeight() - 595.276) > 2 || page.getRotation().angle !== 0) {
    throw new MyGlsPrintLayoutError("GLS format adresnice nije prepoznat za štampu 4 nalepnice po listu.");
  }
  const blocks = readMyGlsPageText(document, page);
  const recipients = blocks.filter((block) => /^primalac\s*:/iu.test(block.text.trim()));
  const slots = recipients.map((recipient) => {
    const sender = blocks.find((block) => /^po[sš]iljalac\s*:/iu.test(block.text.trim()) &&
      Math.abs(block.x - recipient.x - 63) < 2 && Math.abs(recipient.y - block.y - 163) < 3);
    if (!sender || ![197, 199, 597].some((x) => Math.abs(recipient.x - x) < 2) ||
      ![89.0338, 99.0338, 389.0338].some((y) => Math.abs(sender.y - y) < 2)) {
      throw new MyGlsPrintLayoutError("GLS raspored adresnice nije prepoznat; originalni kurirski podaci nisu menjani.");
    }
    return { x: recipient.x, y: sender.y };
  }).sort((a, b) => b.y - a.y || a.x - b.x);
  if (!slots.length || slots.length > 4 || new Set(slots.map((s) => `${s.x}:${s.y}`)).size !== slots.length) {
    throw new MyGlsPrintLayoutError("GLS PDF nema prepoznatljiv raspored paketa.");
  }
  return slots;
}

/** GLS shrinks its whole Content string to one tiny line. Reflow only that field. */
export async function enlargeMyGlsArticleText(source: Uint8Array) {
  const document = await PDFDocument.load(source, { updateMetadata: false });
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  let changed = false;
  for (const page of document.getPages()) {
    if (page.node.has(ARTICLE_MARKER)) continue;
    const blocks = readMyGlsPageText(document, page);
    const slots = labelSlots(document, page);
    const isSlotContent = (slot: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(b.x - slot.x) < 2 && b.y > slot.y + 5 && b.y < slot.y + 55;
    removeMyGlsPageText(document, page, (b) => slots.some((slot) => isSlotContent(slot, b)));
    for (const slot of slots) {
      const isContent = (b: { x: number; y: number }) => isSlotContent(slot, b);
      const content = blocks.filter(isContent).sort((a, b) => b.y - a.y).map((b) => b.text).join(" ").trim();
      if (!content) continue;
      const [name, ...identifiers] = content.split(/\s*\/\s*(?=(?:Sifra|Šifra|EAN):)/);
      const title = latinText(name!);
      const details = latinText(identifiers.join(" / "));
      const detailSize = details ? Math.min(8.5, 210 / regular.widthOfTextAtSize(details, 1)) : 8.5;
      if (detailSize < 7) throw new MyGlsPrintLayoutError("Identifikatori artikla ne staju čitljivo na GLS adresnicu.");
      const lines = wrapTitle(title, font, 11, 210, details ? 2 : 3);
      lines.forEach((line, index) => page.drawText(line, { x: slot.x, y: slot.y + 34 - index * 12, font, size: 11 }));
      if (details) page.drawText(details, { x: slot.x, y: slot.y + 10, font: regular, size: detailSize });
      changed = true;
    }
    page.node.set(ARTICLE_MARKER, document.context.obj(true));
  }
  return changed ? Buffer.from(await document.save()) : Buffer.from(source);
}

function latinText(value: string) {
  return value.replace(/đ/g, "dj").replace(/Đ/g, "Dj").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "?");
}

function wrapTitle(value: string, font: PDFFont, size: number, width: number, maxLines: number) {
  const lines: string[] = [];
  let rest = value;
  while (rest && lines.length < maxLines) {
    let length = rest.length;
    while (length > 0 && font.widthOfTextAtSize(rest.slice(0, length), size) > width) length--;
    if (length < rest.length && lines.length === maxLines - 1) {
      while (length > 0 && font.widthOfTextAtSize(rest.slice(0, length) + "...", size) > width) length--;
      lines.push(rest.slice(0, length).trimEnd() + "...");
      break;
    }
    if (length < rest.length && rest.lastIndexOf(" ", length) > 0) length = rest.lastIndexOf(" ", length);
    lines.push(rest.slice(0, length));
    rest = rest.slice(length).trimStart();
  }
  return lines;
}

export type MyGlsPrintSource = { bytes: Uint8Array; packageCount: number; groupKey: string };

/** Compact existing courier labels, never call PrintLabels or recreate a shipment. */
export async function packMyGlsLabels(sources: readonly MyGlsPrintSource[], title: string) {
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.HelveticaBold);
  const totals = new Map<string, number>();
  for (const source of sources) totals.set(source.groupKey, (totals.get(source.groupKey) ?? 0) + source.packageCount);
  const counters = new Map<string, number>();
  let count = 0;
  for (const source of sources) {
    const document = await PDFDocument.load(source.bytes);
    const labels = document.getPages().flatMap((page) => labelSlots(document, page).map((slot) => ({ page, ...slot })));
    if (labels.length !== source.packageCount) {
      throw new MyGlsPrintLayoutError(`GLS PDF sadrži ${labels.length} od ${source.packageCount} očekivanih adresnica. Proverite pakete pre štampe.`);
    }
    for (const label of labels) {
      // Native label content spans about 398 x 260pt. Its original vector
      // barcodes stay at 100%; rotating into A4 portrait prevents Safari's
      // landscape-to-portrait shrink and fits standard four-up sticker stock.
      const embedded = await output.embedPage(label.page, {
        left: label.x - 176, right: label.x + 222,
        bottom: label.y - 64, top: label.y + 196,
      });
      if (count % 4 === 0) output.addPage([595.276, 841.89]);
      const page = output.getPage(output.getPageCount() - 1);
      const column = count % 2;
      const row = Math.floor((count % 4) / 2);
      const left = column * 297.638;
      const bottom = (1 - row) * 420.945;
      page.drawPage(embedded, { x: left + 283, y: bottom + 11, rotate: degrees(90) });
      const number = (counters.get(source.groupKey) ?? 0) + 1;
      counters.set(source.groupKey, number);
      // Keep the provider's "Komad 1/1" intact: it describes the individual
      // courier parcel. Our order-wide count is a separate warehouse field.
      page.drawText(`Paket ${number}/${totals.get(source.groupKey)}`, {
        x: left + 24, y: bottom + 180, size: 13, font, rotate: degrees(90),
      });
      count++;
    }
  }
  if (!count) throw new MyGlsPrintLayoutError("Nema GLS adresnica za štampu.");
  output.setTitle(title);
  output.setAuthor("Svet povoljnih cena");
  output.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  return Buffer.from(await output.save());
}
