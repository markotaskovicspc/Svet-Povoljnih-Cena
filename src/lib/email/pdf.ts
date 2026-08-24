import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { rasterJpegPagesPdf } from "@/lib/pdf/raster-pages";
import { renderPdfSvgToJpeg } from "@/lib/pdf/render-svg";

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
const DOCUMENT_DATE_FORMATTER = new Intl.DateTimeFormat("sr-Latn-RS", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Belgrade",
});

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

type InvoiceLine = {
  name: string;
  sku: string;
  qty: number;
  gross: number;
};

const INVOICE_PIXEL_WIDTH = 1240;
const INVOICE_PIXEL_HEIGHT = 1754;
const INVOICE_ROWS_PER_PAGE = 10;

export async function buildInvoicePdf(order: InvoiceOrderInput): Promise<Buffer> {
  const lines: InvoiceLine[] = order.items.flatMap((item) => [
    {
      name: item.name,
      sku: item.sku,
      qty: item.qty,
      gross: item.unitPriceSale * item.qty,
    },
    ...(item.assemblyPrice && item.assemblyPrice > 0
      ? [{
          name: `Montaža — ${item.name}`,
          sku: `${item.sku}-M`,
          qty: item.qty,
          gross: item.assemblyPrice * item.qty,
        }]
      : []),
  ]);
  if (order.shipping > 0) {
    lines.push({ name: "Isporuka", sku: "—", qty: 1, gross: order.shipping });
  }
  if (order.voucherCode && order.voucherDiscount) {
    lines.push({
      name: `Vaučer ${order.voucherCode}`,
      sku: "—",
      qty: 1,
      gross: -order.voucherDiscount,
    });
  }
  if (order.firstPurchaseDiscount) {
    lines.push({
      name: "Popust za prvu kupovinu",
      sku: "—",
      qty: 1,
      gross: -order.firstPurchaseDiscount,
    });
  }
  if (order.savedCardDiscount) {
    lines.push({
      name: "Popust za sačuvanu karticu",
      sku: "—",
      qty: 1,
      gross: -order.savedCardDiscount,
    });
  }
  const pages = chunkInvoiceLines(lines, INVOICE_ROWS_PER_PAGE);
  const jpegPages = await Promise.all(
    pages.map((pageLines, pageIndex) =>
      renderPdfSvgToJpeg(
        invoicePageSvg(order, pageLines, pageIndex, pages.length),
      ),
    ),
  );
  return rasterJpegPagesPdf({
    pages: jpegPages,
    pixelWidth: INVOICE_PIXEL_WIDTH,
    pixelHeight: INVOICE_PIXEL_HEIGHT,
    pdfWidth: PAGE_WIDTH,
    pdfHeight: PAGE_HEIGHT,
  });
}

function invoicePageSvg(
  order: InvoiceOrderInput,
  lines: InvoiceLine[],
  pageIndex: number,
  pageCount: number,
) {
  const blue = "#124987";
  const tableX = 70;
  const tableY = 430;
  const headerHeight = 56;
  const rowHeight = 66;
  const widths = [390, 135, 75, 155, 155, 190];
  const headers = ["Naziv artikla", "Šifra", "Kol.", "Osnovica", "PDV 20%", "Ukupno"];
  let headerX = tableX;
  const header = headers
    .map((label, index) => {
      const width = widths[index]!;
      const value = `<rect x="${headerX}" y="${tableY}" width="${width}" height="${headerHeight}" class="head"/><text x="${headerX + 13}" y="${tableY + 35}" class="headText">${xmlEscapePdf(label)}</text>`;
      headerX += width;
      return value;
    })
    .join("");
  const rows = lines
    .map((line, index) => {
      const y = tableY + headerHeight + index * rowHeight;
      const basis = line.gross / 1.2;
      const vat = line.gross - basis;
      const values = [
        line.name,
        line.sku,
        String(line.qty),
        formatInvoiceMoney(basis),
        formatInvoiceMoney(vat),
        formatInvoiceMoney(line.gross),
      ];
      let x = tableX;
      return values
        .map((value, columnIndex) => {
          const width = widths[columnIndex]!;
          const alignRight = columnIndex >= 2;
          const anchor = alignRight ? "end" : "start";
          const textX = alignRight ? x + width - 12 : x + 12;
          const text =
            columnIndex === 0
              ? invoiceMultilineText(textX, y + 25, value, 42)
              : `<text x="${textX}" y="${y + 39}" text-anchor="${anchor}" class="cell${alignRight ? " numeric" : ""}">${xmlEscapePdf(value)}</text>`;
          const cell = `<rect x="${x}" y="${y}" width="${width}" height="${rowHeight}" class="cellBox"/>${text}`;
          x += width;
          return cell;
        })
        .join("");
    })
    .join("");
  const tableBottom = tableY + headerHeight + lines.length * rowHeight;
  const isLast = pageIndex === pageCount - 1;
  const basisTotal = order.total / 1.2;
  const vatTotal = order.total - basisTotal;
  const totals = isLast
    ? `<g transform="translate(650 ${tableBottom + 55})">
        <text x="0" y="0" class="totalLabel">Osnovica bez PDV-a</text><text x="500" y="0" text-anchor="end" class="totalValue">${xmlEscapePdf(formatInvoiceMoney(basisTotal))}</text>
        <text x="0" y="48" class="totalLabel">PDV 20%</text><text x="500" y="48" text-anchor="end" class="totalValue">${xmlEscapePdf(formatInvoiceMoney(vatTotal))}</text>
        <rect x="-18" y="75" width="536" height="88" fill="#eaf1fa"/>
        <text x="0" y="130" class="grandLabel">UKUPNO ZA UPLATU</text><text x="500" y="130" text-anchor="end" class="grandValue">${xmlEscapePdf(formatInvoiceMoney(order.total))}</text>
      </g>
      <rect x="70" y="${tableBottom + 260}" width="1100" height="74" class="infoBox"/>
      <text x="92" y="${tableBottom + 306}" class="infoLabel">NAČIN PLAĆANJA</text>
      <text x="1148" y="${tableBottom + 306}" text-anchor="end" class="infoValue">${xmlEscapePdf(paymentMethodLabel(order.paymentMethod))}</text>
      <text x="82" y="${tableBottom + 380}" class="note">PDV 20% je prikazan po svakoj stavci i uključen je u ukupnu cenu.</text>`
    : "";
  const logo = LOGO_JPEG
    ? `<image x="70" y="58" width="390" height="65" preserveAspectRatio="xMinYMid meet" href="data:image/jpeg;base64,${LOGO_JPEG.toString("base64")}"/>`
    : `<text x="70" y="104" class="brand">Svet Povoljnih Cena</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${INVOICE_PIXEL_WIDTH}" height="${INVOICE_PIXEL_HEIGHT}" viewBox="0 0 ${INVOICE_PIXEL_WIDTH} ${INVOICE_PIXEL_HEIGHT}">
    <style>
      text { font-family: Geist, sans-serif; fill: #28313b; }
      .brand { font-size: 34px; font-weight: 800; fill: ${blue}; }
      .docTitle { font-size: 46px; font-weight: 800; fill: ${blue}; letter-spacing: 1px; }
      .docNo { font-size: 23px; font-weight: 700; fill: #202b38; }
      .date { font-size: 17px; fill: #3f4852; }
      .partyBox, .cellBox, .infoBox { fill: #fff; stroke: #d5dce5; stroke-width: 1.5; }
      .partyLabel { font-size: 17px; font-weight: 800; fill: ${blue}; }
      .party { font-size: 16px; }
      .head { fill: ${blue}; stroke: #fff; stroke-width: 1; }
      .headText { font-size: 16px; font-weight: 700; fill: #fff; }
      .cell { font-size: 15px; }
      .numeric { font-weight: 600; }
      .totalLabel, .totalValue { font-size: 17px; }
      .totalValue { font-weight: 600; }
      .grandLabel { font-size: 24px; font-weight: 800; fill: ${blue}; }
      .grandValue { font-size: 28px; font-weight: 800; fill: ${blue}; }
      .infoLabel { font-size: 17px; font-weight: 800; fill: ${blue}; }
      .infoValue { font-size: 17px; font-weight: 600; }
      .note { font-size: 14px; fill: #57616d; }
      .footer { font-size: 13px; fill: #697380; }
    </style>
    <rect width="1240" height="1754" fill="#fff"/>
    ${logo}
    <text x="1170" y="86" text-anchor="end" class="docTitle">PREDRAČUN</text>
    <text x="1170" y="119" text-anchor="end" class="docNo">${xmlEscapePdf(order.number)}</text>
    <text x="1170" y="148" text-anchor="end" class="date">Datum: ${xmlEscapePdf(DOCUMENT_DATE_FORMATTER.format(order.createdAt))}</text>
    <rect x="70" y="165" width="1100" height="4" fill="${blue}"/>
    <rect x="70" y="205" width="550" height="170" class="partyBox"/>
    <rect x="620" y="205" width="550" height="170" class="partyBox"/>
    <text x="92" y="242" class="partyLabel">PRODAVAC</text>
    ${partyText(92, 274, [MERCHANT_LEGAL_INFO.name, `PIB: ${MERCHANT_LEGAL_INFO.pib} · Matični broj: ${MERCHANT_LEGAL_INFO.registrationNumber}`, MERCHANT_LEGAL_INFO.shortAddress, `Tekući račun: ${MERCHANT_LEGAL_INFO.bankAccount} (${MERCHANT_LEGAL_INFO.bankName})`])}
    <text x="642" y="242" class="partyLabel">KUPAC</text>
    ${partyText(642, 274, [`${order.shipping_address.firstName} ${order.shipping_address.lastName}`, `${order.shipping_address.street},`, `${order.shipping_address.postalCode} ${order.shipping_address.city}`])}
    ${header}${rows}${totals}
    <text x="70" y="1662" class="footer">Predračun nije fiskalni račun.</text>
    <text x="70" y="1690" class="footer">${xmlEscapePdf(MERCHANT_LEGAL_INFO.name)} · PIB ${xmlEscapePdf(MERCHANT_LEGAL_INFO.pib)}</text>
    <text x="1170" y="1690" text-anchor="end" class="footer">Strana ${pageIndex + 1}/${pageCount}</text>
  </svg>`;
}

function partyText(x: number, y: number, values: string[]) {
  return `<text x="${x}" y="${y}" class="party">${values
    .map(
      (value, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : 25}">${xmlEscapePdf(value)}</tspan>`,
    )
    .join("")}</text>`;
}

function invoiceMultilineText(x: number, y: number, value: string, limit: number) {
  const words = value.trim().split(/\s+/);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current || `${current} ${word}`.length <= limit) {
      current = current ? `${current} ${word}` : word;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return `<text x="${x}" y="${y}" class="cell">${result
    .slice(0, 2)
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : 21}">${xmlEscapePdf(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function chunkInvoiceLines(lines: InvoiceLine[], size: number) {
  if (!lines.length) return [[]];
  return Array.from({ length: Math.ceil(lines.length / size) }, (_, index) =>
    lines.slice(index * size, (index + 1) * size),
  );
}

function formatInvoiceMoney(value: number) {
  return `${new Intl.NumberFormat("sr-Latn-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/\u00a0/g, " ")} RSD`;
}

function paymentMethodLabel(value: string) {
  const labels: Record<string, string> = {
    IPS: "IPS Skeniraj",
    KARTICA: "Platna kartica",
    GOOGLE_PAY: "Google Pay",
    APPLE_PAY: "Apple Pay",
    UPLATA_NA_RACUN: "Uplata na račun",
    POUZECE_GOTOVINA: "Pouzeće — gotovina",
    POUZECE_KARTICA: "Pouzeće — kartica",
  };
  return labels[value.trim().toUpperCase()] ?? value;
}

function xmlEscapePdf(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const WITHDRAWAL_FIRST_PAGE_ITEMS = 6;
const WITHDRAWAL_NEXT_PAGE_ITEMS = 10;

export async function buildWithdrawalFormPdf(
  order: InvoiceOrderInput,
): Promise<Buffer> {
  const pageSvgs = buildWithdrawalFormPageSvgs(order);
  const jpegPages = await Promise.all(
    pageSvgs.map((svg) => renderPdfSvgToJpeg(svg)),
  );

  return rasterJpegPagesPdf({
    pages: jpegPages,
    pixelWidth: INVOICE_PIXEL_WIDTH,
    pixelHeight: INVOICE_PIXEL_HEIGHT,
    pdfWidth: PAGE_WIDTH,
    pdfHeight: PAGE_HEIGHT,
  });
}

export function buildWithdrawalFormPageSvgs(order: InvoiceOrderInput) {
  const pages = paginateWithdrawalItems(order.items);
  return pages.map((items, pageIndex) =>
    withdrawalFormPageSvg(order, items, pageIndex, pages.length),
  );
}

function paginateWithdrawalItems(items: InvoiceOrderInput["items"]) {
  if (items.length <= WITHDRAWAL_FIRST_PAGE_ITEMS) return [items];

  const pages = [items.slice(0, WITHDRAWAL_FIRST_PAGE_ITEMS)];
  for (
    let index = WITHDRAWAL_FIRST_PAGE_ITEMS;
    index < items.length;
    index += WITHDRAWAL_NEXT_PAGE_ITEMS
  ) {
    pages.push(items.slice(index, index + WITHDRAWAL_NEXT_PAGE_ITEMS));
  }
  return pages;
}

function withdrawalFormPageSvg(
  order: InvoiceOrderInput,
  items: InvoiceOrderInput["items"],
  pageIndex: number,
  pageCount: number,
) {
  const blue = "#123F5A";
  const ink = "#172B36";
  const muted = "#5F6F78";
  const line = "#DCE6EA";
  const soft = "#F2F7F9";
  const firstPage = pageIndex === 0;
  const lastPage = pageIndex === pageCount - 1;
  const tableX = 70;
  const tableY = firstPage ? 610 : 320;
  const headerHeight = 58;
  const rowHeight = 88;
  const widths = [105, 465, 170, 135, 225];
  const headers = ["Vraćam", "Artikal", "Šifra", "Naručeno", "Količina za povraćaj"];
  let headerX = tableX;
  const header = headers
    .map((label, index) => {
      const width = widths[index]!;
      const centered = index !== 1;
      const x = centered ? headerX + width / 2 : headerX + 14;
      const anchor = centered ? ' text-anchor="middle"' : "";
      const value = `<rect x="${headerX}" y="${tableY}" width="${width}" height="${headerHeight}" class="tableHead"/><text x="${x}" y="${tableY + 36}"${anchor} class="tableHeadText">${xmlEscapePdf(label)}</text>`;
      headerX += width;
      return value;
    })
    .join("");

  let rowY = tableY + headerHeight;
  const rows = items
    .map((item) => {
      const y = rowY;
      rowY += rowHeight;
      const nameLines = wrapSvgText(item.name, 38).slice(0, 2);
      const name = `<text x="${tableX + widths[0]! + 14}" y="${y + 32}" class="itemName">${nameLines
        .map(
          (value, index) =>
            `<tspan x="${tableX + widths[0]! + 14}" dy="${index === 0 ? 0 : 24}">${xmlEscapePdf(value)}</tspan>`,
        )
        .join("")}</text>`;
      const skuX = tableX + widths[0]! + widths[1]! + widths[2]! / 2;
      const orderedX =
        tableX + widths[0]! + widths[1]! + widths[2]! + widths[3]! / 2;
      const returnX = tableX + widths.slice(0, 4).reduce((sum, width) => sum + width, 0);
      return `<rect x="${tableX}" y="${y}" width="1100" height="${rowHeight}" class="tableRow"/>
        ${withdrawalVerticalLines(tableX, y, rowHeight, widths)}
        <rect x="${tableX + 38}" y="${y + 29}" width="30" height="30" rx="3" class="checkbox"/>
        ${name}
        <text x="${skuX}" y="${y + 51}" text-anchor="middle" class="cell">${xmlEscapePdf(item.sku)}</text>
        <text x="${orderedX}" y="${y + 51}" text-anchor="middle" class="cell">${item.qty}</text>
        <line x1="${returnX + 32}" y1="${y + 58}" x2="${returnX + widths[4]! - 32}" y2="${y + 58}" class="writeLine"/>`;
    })
    .join("");
  const tableBottom = rowY;
  const logo = LOGO_JPEG
    ? `<image x="70" y="58" width="390" height="65" preserveAspectRatio="xMinYMid meet" href="data:image/jpeg;base64,${LOGO_JPEG.toString("base64")}"/>`
    : `<text x="70" y="104" class="brand">Svet Povoljnih Cena</text>`;
  const pageIntro = firstPage
    ? `<text x="70" y="238" class="title">OBRAZAC ZA ODUSTANAK</text>
      <text x="70" y="278" class="legal">Obrazac za odustanak od ugovora zaključenog na daljinu</text>
      <rect x="70" y="315" width="1100" height="88" rx="9" class="notice"/>
      <text x="94" y="350" class="noticeTitle">Kako da označite artikle</text>
      <text x="94" y="380" class="noticeText">Stavite X u prazno polje uz svaki artikal koji vraćate i upišite količinu za povraćaj.</text>
      <rect x="70" y="432" width="1100" height="126" rx="9" class="metaBox"/>
      <text x="94" y="468" class="metaLabel">BROJ PORUDŽBINE</text>
      <text x="94" y="500" class="metaValue">${xmlEscapePdf(order.number)}</text>
      <text x="430" y="468" class="metaLabel">DATUM PORUDŽBINE</text>
      <text x="430" y="500" class="metaValue">${xmlEscapePdf(DOCUMENT_DATE_FORMATTER.format(order.createdAt))}</text>
      <text x="700" y="468" class="metaLabel">KUPAC I ADRESA</text>
      <text x="700" y="500" class="metaValue">${xmlEscapePdf(`${order.shipping_address.firstName} ${order.shipping_address.lastName}`)}</text>
      <text x="700" y="530" class="metaText">${xmlEscapePdf(`${order.shipping_address.street}, ${order.shipping_address.postalCode} ${order.shipping_address.city}`)}</text>
      <text x="70" y="595" class="section">Artikli za povraćaj</text>`
    : `<text x="70" y="238" class="title smallTitle">ARTIKLI ZA POVRAĆAJ - NASTAVAK</text>
      <text x="70" y="282" class="legal">Porudžbina ${xmlEscapePdf(order.number)} · označite X i upišite količinu</text>`;

  const continuation = !lastPage
    ? `<text x="70" y="${Math.min(tableBottom + 70, 1570)}" class="continuation">Spisak artikala se nastavlja na sledećoj strani.</text>`
    : "";
  const signatureY = Math.min(tableBottom + 86, 1410);
  const completion = lastPage
    ? `<text x="70" y="${signatureY}" class="section">Izjava kupca</text>
      <text x="70" y="${signatureY + 38}" class="body">Ovim obaveštavam trgovca da odustajem od kupovine označenih artikala iz navedene porudžbine.</text>
      <text x="70" y="${signatureY + 92}" class="fieldLabel">Datum podnošenja</text>
      <line x1="70" y1="${signatureY + 132}" x2="410" y2="${signatureY + 132}" class="writeLine"/>
      <text x="660" y="${signatureY + 92}" class="fieldLabel">Potpis kupca</text>
      <line x1="660" y1="${signatureY + 132}" x2="1170" y2="${signatureY + 132}" class="writeLine"/>
      <rect x="70" y="${signatureY + 174}" width="1100" height="86" rx="8" class="rightsBox"/>
      <text x="92" y="${signatureY + 208}" class="rights">Pravo na odustanak ostvarujete u zakonskom roku, bez obaveze da navedete razlog.</text>
      <text x="92" y="${signatureY + 238}" class="rights">Popunjen obrazac pošaljite na reklamacije@svetpovoljnihcena.rs ili na adresu trgovca.</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${INVOICE_PIXEL_WIDTH}" height="${INVOICE_PIXEL_HEIGHT}" viewBox="0 0 ${INVOICE_PIXEL_WIDTH} ${INVOICE_PIXEL_HEIGHT}">
    <style>
      text { font-family: Geist, sans-serif; fill: ${ink}; }
      .brand { font-size: 34px; font-weight: 800; fill: ${blue}; }
      .docType { font-size: 15px; font-weight: 700; letter-spacing: 1.4px; fill: ${blue}; }
      .docNo { font-size: 17px; font-weight: 700; }
      .title { font-size: 38px; font-weight: 800; fill: ${blue}; letter-spacing: .4px; }
      .smallTitle { font-size: 32px; }
      .legal { font-size: 18px; fill: ${muted}; }
      .notice { fill: #EAF4F7; stroke: #CFE2E8; stroke-width: 1.5; }
      .noticeTitle { font-size: 18px; font-weight: 800; fill: ${blue}; }
      .noticeText { font-size: 17px; }
      .metaBox { fill: #fff; stroke: ${line}; stroke-width: 1.5; }
      .metaLabel { font-size: 13px; font-weight: 800; letter-spacing: 1px; fill: ${muted}; }
      .metaValue { font-size: 19px; font-weight: 700; }
      .metaText { font-size: 15px; fill: ${muted}; }
      .section { font-size: 21px; font-weight: 800; fill: ${blue}; }
      .tableHead { fill: ${blue}; stroke: #fff; stroke-width: 1; }
      .tableHeadText { font-size: 15px; font-weight: 800; fill: #fff; }
      .tableRow { fill: #fff; stroke: ${line}; stroke-width: 1.3; }
      .checkbox { fill: #fff; stroke: ${blue}; stroke-width: 2.5; }
      .itemName { font-size: 16px; font-weight: 650; }
      .cell { font-size: 15px; }
      .writeLine { stroke: #53656f; stroke-width: 1.5; }
      .continuation { font-size: 16px; font-weight: 700; fill: ${blue}; }
      .body { font-size: 16px; }
      .fieldLabel { font-size: 15px; font-weight: 700; fill: ${muted}; }
      .rightsBox { fill: ${soft}; stroke: ${line}; stroke-width: 1.2; }
      .rights { font-size: 15px; fill: ${muted}; }
      .footer { font-size: 12px; fill: ${muted}; }
      .rule { stroke: ${line}; stroke-width: 1; }
    </style>
    <rect width="1240" height="1754" fill="#ffffff"/>
    ${logo}
    <text x="1170" y="82" text-anchor="end" class="docType">ODUSTANAK OD KUPOVINE</text>
    <text x="1170" y="116" text-anchor="end" class="docNo">${xmlEscapePdf(order.number)}</text>
    <rect x="70" y="165" width="1100" height="4" fill="${blue}"/>
    ${pageIntro}
    ${header}${rows}${continuation}${completion}
    <text x="70" y="1690" class="footer">${xmlEscapePdf(MERCHANT_LEGAL_INFO.name)} · PIB ${xmlEscapePdf(MERCHANT_LEGAL_INFO.pib)} · ${xmlEscapePdf(MERCHANT_LEGAL_INFO.shortAddress)}</text>
    <text x="1170" y="1690" text-anchor="end" class="footer">Strana ${pageIndex + 1}/${pageCount}</text>
  </svg>`;
}

function withdrawalVerticalLines(
  x: number,
  y: number,
  height: number,
  widths: number[],
) {
  let cursor = x;
  return widths
    .slice(0, -1)
    .map((width) => {
      cursor += width;
      return `<line x1="${cursor}" y1="${y}" x2="${cursor}" y2="${y + height}" class="rule"/>`;
    })
    .join("");
}

function wrapSvgText(value: string, limit: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current || `${current} ${word}`.length <= limit) {
      current = current ? `${current} ${word}` : word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export type { InvoiceOrderInput };
