import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

/**
 * Minimal PDF generator for the order confirmation attachments
 * (`predracun-racun.pdf` and `obrazac-za-odustajanje.pdf`).
 *
 * We hand-roll a compact multi-page PDF rather than pulling in a PDF library:
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
const HEADER_HEIGHT = 62;
const LOGO_WIDTH = 240;
const LOGO_HEIGHT = 39.8;

const LOGO_JPEG = (() => {
  try {
    return readFileSync(
      join(process.cwd(), "public", "documents", "garantni-list-logo.jpeg"),
    );
  } catch {
    return null;
  }
})();

interface Line {
  text: string;
  bold?: boolean;
  size?: number;
  spaceAbove?: number;
}

export function buildPdf(title: string, lines: Line[]): Buffer {
  const sanitized = [
    { text: title, bold: true, size: TITLE_SIZE },
    { text: "", spaceAbove: 8 },
    ...lines,
  ]
    .map((line) => ({ ...line, text: transliterate(line.text) }))
    .flatMap((line) =>
      wrapPdfText(line.text, line.size ?? FONT_SIZE, Boolean(line.bold)).map(
        (text, index) => ({
          ...line,
          text,
          spaceAbove: index === 0 ? line.spaceAbove : 0,
        }),
      ),
    );

  // Paginate before creating the PDF objects so no line is silently dropped.
  const pages: string[][] = [[]];
  let cursorY = PAGE_HEIGHT - MARGIN_Y - HEADER_HEIGHT;
  for (const line of sanitized) {
    const size = line.size ?? FONT_SIZE;
    const font = line.bold ? "/F2" : "/F1";
    const advance = (line.spaceAbove ?? 0) + (line.size ? line.size + 4 : LINE_HEIGHT);
    if (cursorY - advance < MARGIN_Y && pages.at(-1)!.length) {
      pages.push([]);
      cursorY = PAGE_HEIGHT - MARGIN_Y - HEADER_HEIGHT;
    }
    cursorY -= advance;
    pages.at(-1)!.push(
      `${font} ${size} Tf\n1 0 0 1 ${MARGIN_X} ${cursorY} Tm\n(${pdfEscape(line.text)}) Tj`,
    );
  }

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
  const logoObject = LOGO_JPEG
    ? push(
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 199 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${LOGO_JPEG.length * 2 + 1} >>\nstream\n${LOGO_JPEG.toString("hex").toUpperCase()}>\nendstream`,
      )
    : null;
  const pageObjects = pages.map((page) => {
    const brandedHeader = [
      logoObject
        ? `q\n${LOGO_WIDTH} 0 0 ${LOGO_HEIGHT} ${MARGIN_X} ${PAGE_HEIGHT - 50} cm\n/Logo Do\nQ`
        : "",
      "0 0.207 0.475 rg",
      `${MARGIN_X} ${PAGE_HEIGHT - 63} ${PAGE_WIDTH - MARGIN_X * 2} 3 re f`,
      "0 g",
    ]
      .filter(Boolean)
      .join("\n");
    const stream = `${brandedHeader}\nBT\n${page.join("\n")}\nET`;
    const contentObj = push(
      `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    );
    const logoResource = logoObject
      ? ` /XObject << /Logo ${logoObject} 0 R >>`
      : "";
    return push(
      `<< /Type /Page /Parent __PARENT__ /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontHelvetica} 0 R /F2 ${fontHelveticaBold} 0 R >>${logoResource} >> >>`,
    );
  });
  const pagesObj = push(
    `<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjects.length} >>`,
  );
  const catalogObj = push(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  // Patch the Page parent references now that we know the Pages object id.
  for (const pageObj of pageObjects) {
    objects[pageObj - 1] = objects[pageObj - 1]!.replace(
      "__PARENT__",
      `${pagesObj} 0 R`,
    );
  }

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

function wrapPdfText(text: string, size: number, bold: boolean) {
  if (!text) return [""];
  const usableWidth = PAGE_WIDTH - MARGIN_X * 2;
  const averageGlyphWidth = size * (bold ? 0.57 : 0.52);
  const maxCharacters = Math.max(16, Math.floor(usableWidth / averageGlyphWidth));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks = Array.from(
      { length: Math.ceil(word.length / maxCharacters) },
      (_, index) => word.slice(index * maxCharacters, (index + 1) * maxCharacters),
    );
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length <= maxCharacters) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
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
  firstPurchaseDiscount?: number | null;
  savedCardDiscount?: number | null;
  total: number;
  paymentMethod: string;
  shipping_address: { firstName: string; lastName: string; street: string; postalCode: string; city: string };
}

const fmt = (n: number) => `${n.toLocaleString("sr-Latn-RS").replace(/\u00A0/g, " ")} RSD`;

export function buildInvoicePdf(order: InvoiceOrderInput): Buffer {
  const lines: Line[] = [
    { text: `Datum: ${order.createdAt.toLocaleDateString("sr-Latn-RS")}` },
    { text: "" },
    { text: "Prodavac:", bold: true },
    { text: MERCHANT_LEGAL_INFO.name },
    {
      text: `PIB: ${MERCHANT_LEGAL_INFO.pib} · Matični broj: ${MERCHANT_LEGAL_INFO.registrationNumber}`,
    },
    { text: MERCHANT_LEGAL_INFO.shortAddress },
    {
      text: `Tekući račun: ${MERCHANT_LEGAL_INFO.bankAccount} (${MERCHANT_LEGAL_INFO.bankName})`,
    },
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
  if (order.firstPurchaseDiscount) {
    lines.push({ text: `Popust za prvu kupovinu: -${fmt(order.firstPurchaseDiscount)}` });
  }
  if (order.savedCardDiscount) {
    lines.push({ text: `Popust za sačuvanu karticu: -${fmt(order.savedCardDiscount)}` });
  }
  lines.push({ text: `Ukupno za uplatu: ${fmt(order.total)}`, bold: true, size: 13, spaceAbove: 6 });
  lines.push({ text: "" });
  lines.push({ text: `Način plaćanja: ${order.paymentMethod}` });
  lines.push({ text: "" });
  lines.push({ text: "Ovaj dokument je interna potvrda kupovine za kupca." });
  lines.push({ text: MERCHANT_LEGAL_INFO.pdvNote });

  return buildPdf(`Predračun / račun ${order.number}`, lines);
}

export function buildWithdrawalFormPdf(order: InvoiceOrderInput): Buffer {
  const lines: Line[] = [
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
    {
      text: "Zaokružite artikal koji vraćate i upišite količinu.",
      bold: true,
      spaceAbove: 4,
    },
  ];
  for (const it of order.items) {
    lines.push({
      text: `(   ) ${it.name} (${it.sku}) | Količina: __________`,
      spaceAbove: 3,
    });
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
