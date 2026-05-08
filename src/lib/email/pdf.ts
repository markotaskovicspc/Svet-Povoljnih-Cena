import "server-only";

/**
 * Phase 4D — minimal PDF generator for the order confirmation attachments
 * (`predracun.pdf` and `obrazac-za-odustajanje.pdf`).
 *
 * We hand-roll a single-page PDF rather than pulling in a PDF library:
 *   - PDF text uses standard 14 fonts (Helvetica / Helvetica-Bold) which are
 *     guaranteed available in every viewer and don't require font embedding.
 *   - WinAnsiEncoding is the default for those fonts, which only covers a
 *     subset of Serbian Latin diacritics. To stay readable across every PDF
 *     client we transliterate č/ć/š/ž/đ → c/c/s/z/dj before writing. A real
 *     TTF embed lands when we replace this with a proper PDF lib in v1.1.
 */

const FONT_SIZE = 11;
const TITLE_SIZE = 18;
const LINE_HEIGHT = 14;
const PAGE_WIDTH = 595; // A4 in points
const PAGE_HEIGHT = 842;
const MARGIN_X = 50;
const MARGIN_Y = 60;

interface Line {
  text: string;
  bold?: boolean;
  size?: number;
  spaceAbove?: number;
}

export function buildPdf(title: string, lines: Line[]): Buffer {
  const sanitized: Line[] = [{ text: title, bold: true, size: TITLE_SIZE }, { text: "", spaceAbove: 8 }, ...lines].map(
    (l) => ({ ...l, text: transliterate(l.text) }),
  );

  // Build content stream: y starts at top margin and decreases per line.
  const contentLines: string[] = ["BT"];
  let cursorY = PAGE_HEIGHT - MARGIN_Y;
  let firstSet = false;
  for (const line of sanitized) {
    const size = line.size ?? FONT_SIZE;
    const font = line.bold ? "/F2" : "/F1";
    const advance = (line.spaceAbove ?? 0) + (line.size ? line.size + 4 : LINE_HEIGHT);
    cursorY -= advance;
    if (!firstSet) {
      contentLines.push(`${font} ${size} Tf`);
      contentLines.push(`${MARGIN_X} ${cursorY} Td`);
      firstSet = true;
    } else {
      contentLines.push(`${font} ${size} Tf`);
      contentLines.push(`0 ${-advance} Td`);
    }
    contentLines.push(`(${pdfEscape(line.text)}) Tj`);
    if (cursorY < MARGIN_Y) break; // single-page only
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");

  // Object table
  const objects: string[] = [];
  const push = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontHelvetica = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontHelveticaBold = push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const contentObj = push(`<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`);
  const pageObj = push(
    `<< /Type /Page /Parent __PARENT__ /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontHelvetica} 0 R /F2 ${fontHelveticaBold} 0 R >> >> >>`,
  );
  const pagesObj = push(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`);
  const catalogObj = push(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  // Patch the Page's parent reference now that we know the Pages object id.
  objects[pageObj - 1] = objects[pageObj - 1]!.replace("__PARENT__", `${pagesObj} 0 R`);

  // Assemble the file with proper xref offsets.
  const header = "%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n";
  let body = "";
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "binary");
  objects.forEach((obj, i) => {
    offsets.push(cursor);
    const block = `${i + 1} 0 obj\n${obj}\nendobj\n`;
    body += block;
    cursor += Buffer.byteLength(block, "binary");
  });

  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, "binary");
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const TRANSLIT: Record<string, string> = {
  č: "c",
  ć: "c",
  š: "s",
  ž: "z",
  đ: "dj",
  Č: "C",
  Ć: "C",
  Š: "S",
  Ž: "Z",
  Đ: "Dj",
  "—": "-",
  "–": "-",
  "„": '"',
  "”": '"',
  "’": "'",
};

function transliterate(s: string): string {
  let out = "";
  for (const ch of s) out += TRANSLIT[ch] ?? ch;
  // Strip remaining non-WinAnsi codepoints to keep PDF viewers happy.
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "?");
}

interface InvoiceOrderInput {
  number: string;
  createdAt: Date;
  items: { sku: string; name: string; qty: number; unitPriceSale: number; assemblyPrice?: number | null }[];
  subtotal: number;
  shipping: number;
  assemblyTotal: number;
  voucherCode?: string | null;
  voucherDiscount?: number | null;
  total: number;
  paymentMethod: string;
  shipping_address: { firstName: string; lastName: string; street: string; postalCode: string; city: string };
}

const fmt = (n: number) => `${n.toLocaleString("sr-Latn-RS").replace(/\u00A0/g, " ")} RSD`;

export function buildInvoicePdf(order: InvoiceOrderInput): Buffer {
  const lines: Line[] = [
    { text: `Predračun broj ${order.number}`, bold: true, size: 13 },
    { text: `Datum: ${order.createdAt.toLocaleDateString("sr-Latn-RS")}` },
    { text: "" },
    { text: "Kupac:", bold: true },
    {
      text: `${order.shipping_address.firstName} ${order.shipping_address.lastName}`,
    },
    {
      text: `${order.shipping_address.street}, ${order.shipping_address.postalCode} ${order.shipping_address.city}`,
    },
    { text: "" },
    { text: "Stavke:", bold: true, spaceAbove: 4 },
  ];
  for (const it of order.items) {
    lines.push({
      text: `${it.qty} x ${it.name} (${it.sku}) — ${fmt(it.unitPriceSale * it.qty)}`,
    });
    if (it.assemblyPrice && it.assemblyPrice > 0) {
      lines.push({ text: `   + montaža: ${fmt(it.assemblyPrice * it.qty)}` });
    }
  }
  lines.push({ text: "" });
  lines.push({ text: `Artikli: ${fmt(order.subtotal)}` });
  lines.push({ text: `Isporuka: ${fmt(order.shipping)}` });
  if (order.assemblyTotal > 0) lines.push({ text: `Montaža: ${fmt(order.assemblyTotal)}` });
  if (order.voucherCode && order.voucherDiscount) {
    lines.push({ text: `Vaučer ${order.voucherCode}: -${fmt(order.voucherDiscount)}` });
  }
  lines.push({ text: `Ukupno za uplatu: ${fmt(order.total)}`, bold: true, size: 13, spaceAbove: 6 });
  lines.push({ text: "" });
  lines.push({ text: `Način plaćanja: ${order.paymentMethod}` });
  lines.push({ text: "" });
  lines.push({
    text: "Ovo je predračun u skladu sa Zakonom o ZP. Konačan fiskalni račun se izdaje po preuzimanju robe iz skladišta.",
  });

  return buildPdf("Predračun", lines);
}

export function buildWithdrawalFormPdf(order: InvoiceOrderInput): Buffer {
  const lines: Line[] = [
    { text: "Obrazac za odustanak od ugovora na daljinu" },
    { text: "(Zakon o zaštiti potrošača, član 28)", spaceAbove: 2 },
    { text: "" },
    {
      text: "Popunite ovaj obrazac samo ako želite da odustanete od ugovora i pošaljite ga na: reklamacije@svetpovoljnihcena.rs ili poštom na adresu sedišta firme.",
    },
    { text: "" },
    { text: `Broj porudžbine: ${order.number}` },
    { text: `Datum porudžbine: ${order.createdAt.toLocaleDateString("sr-Latn-RS")}` },
    {
      text: `Kupac: ${order.shipping_address.firstName} ${order.shipping_address.lastName}, ${order.shipping_address.street}, ${order.shipping_address.postalCode} ${order.shipping_address.city}`,
    },
    { text: "" },
    {
      text: "Ovim obaveštavam da odustajem od kupovine sledećih artikala:",
    },
  ];
  for (const it of order.items) {
    lines.push({ text: `- ${it.qty} x ${it.name} (${it.sku})` });
  }
  lines.push({ text: "" });
  lines.push({ text: "Datum: __________________________" });
  lines.push({ text: "Potpis kupca: __________________________" });
  lines.push({ text: "" });
  lines.push({
    text: "Pravo na odustanak imate u roku od 14 dana od preuzimanja robe, bez navođenja razloga. Povraćaj sredstava sledi u roku od 14 dana od prijema vraćenog artikla.",
  });
  return buildPdf("Obrazac za odustanak", lines);
}

export type { InvoiceOrderInput };
