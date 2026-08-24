import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { rasterJpegPagesPdf } from "@/lib/pdf/raster-pages";
import { renderPdfSvgToJpeg } from "@/lib/pdf/render-svg";
import type { OrderItem } from "@/types";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH = 595;
const PDF_HEIGHT = 842;
const MAX_ITEM_TABLE_HEIGHT = 430;

export const GUARANTEE_TERM_TEXT = "1 (jedna) godina";
export const GUARANTEE_PROVIDER = {
  name: MERCHANT_LEGAL_INFO.name,
  address: MERCHANT_LEGAL_INFO.shortAddress,
  pib: MERCHANT_LEGAL_INFO.pib,
  reclamationsEmail: "reklamacije@svetpovoljnihcena.rs",
} as const;

type GuaranteeItem = Pick<
  OrderItem,
  "sku" | "name" | "qty" | "categoryName" | "supplierIntegrationKey"
>;

export type GuaranteePdfInput = {
  number: string;
  createdAt: Date;
  items: GuaranteeItem[];
};

type RenderedItem = GuaranteeItem & {
  nameLines: string[];
  categoryLines: string[];
  rowHeight: number;
};

let logoDataUriPromise: Promise<string> | null = null;

export function guaranteeItemsForOrder(items: OrderItem[]) {
  return items.filter(
    (item) => item.supplierIntegrationKey?.trim().toUpperCase() !== "RABALUX",
  );
}

export async function buildGuaranteePdf(input: GuaranteePdfInput) {
  if (!input.items.length) {
    throw new Error("Garantni list zahteva bar jednu stavku.");
  }

  const logoDataUri = await loadLogoDataUri();
  const pages = paginateItems(input.items.map(renderItem));
  const renderedPages = await Promise.all(
    pages.map(async (items, pageIndex) => {
      const svg = guaranteePageSvg({
        ...input,
        items,
        logoDataUri,
        pageIndex,
        pageCount: pages.length,
      });
      return renderPdfSvgToJpeg(svg, 94);
    }),
  );

  return rasterJpegPagesPdf({
    pages: renderedPages,
    pixelWidth: PAGE_WIDTH,
    pixelHeight: PAGE_HEIGHT,
    pdfWidth: PDF_WIDTH,
    pdfHeight: PDF_HEIGHT,
  });
}

function loadLogoDataUri() {
  logoDataUriPromise ??= readFile(
    join(process.cwd(), "public", "documents", "garantni-list-logo.jpeg"),
  ).then((buffer) => `data:image/jpeg;base64,${buffer.toString("base64")}`);
  return logoDataUriPromise;
}

function renderItem(item: GuaranteeItem): RenderedItem {
  const nameLines = wrapText(item.name, 45);
  const categoryLines = wrapText(item.categoryName?.trim() || "Nije navedena", 28);
  const lineCount = Math.max(nameLines.length, categoryLines.length, 1);
  return {
    ...item,
    nameLines,
    categoryLines,
    rowHeight: Math.max(48, 18 + lineCount * 19),
  };
}

function paginateItems(items: RenderedItem[]) {
  const pages: RenderedItem[][] = [];
  let page: RenderedItem[] = [];
  let height = 0;
  for (const item of items) {
    if (page.length && height + item.rowHeight > MAX_ITEM_TABLE_HEIGHT) {
      pages.push(page);
      page = [];
      height = 0;
    }
    page.push(item);
    height += item.rowHeight;
  }
  if (page.length) pages.push(page);
  return pages;
}

function guaranteePageSvg(input: Omit<GuaranteePdfInput, "items"> & {
  items: RenderedItem[];
  logoDataUri: string;
  pageIndex: number;
  pageCount: number;
}) {
  const tableX = 145;
  const tableY = 586;
  const tableWidth = 950;
  const headerHeight = 38;
  const columns = [380, 260, 210, 100];
  const tableBottom =
    tableY + headerHeight + input.items.reduce((sum, item) => sum + item.rowHeight, 0);
  const metaY = tableBottom + 18;
  const termsY = Math.max(830, metaY + 106);
  const rightsY = termsY + 232;
  const pageLabel =
    input.pageCount > 1
      ? `<text x="1095" y="1700" text-anchor="end" class="footer">Strana ${
          input.pageIndex + 1
        }/${input.pageCount}</text>`
      : "";

  let rowY = tableY + headerHeight;
  const itemRows = input.items
    .map((item) => {
      const y = rowY;
      rowY += item.rowHeight;
      return `
        <rect x="${tableX}" y="${y}" width="${tableWidth}" height="${item.rowHeight}" class="row"/>
        ${verticalLines(tableX, y, item.rowHeight, columns)}
        ${multilineText(tableX + 10, y + 24, item.nameLines, "cell")}
        ${multilineText(tableX + columns[0] + 10, y + 24, item.categoryLines, "cell")}
        <text x="${tableX + columns[0] + columns[1] + 10}" y="${y + 29}" class="cell">${xmlEscape(item.sku)}</text>
        <text x="${tableX + tableWidth - columns[3] / 2}" y="${y + 29}" text-anchor="middle" class="cell">${item.qty}</text>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
    <style>
      text { font-family: Geist, sans-serif; fill: #151f2b; }
      .title { font-size: 40px; font-weight: 800; fill: #11283f; }
      .subtitle { font-size: 21px; fill: #30343a; }
      .section { font-size: 23px; font-weight: 700; fill: #3d78a5; }
      .label { font-size: 18px; font-weight: 700; fill: #365e84; }
      .value { font-size: 18px; fill: #101820; }
      .thead { font-size: 16px; font-weight: 700; fill: #365e84; }
      .cell { font-size: 15px; fill: #101820; }
      .body { font-size: 17px; font-weight: 400; fill: #101820; }
      .body-bold { font-size: 17px; font-weight: 700; fill: #365e84; }
      .important { font-size: 16px; font-weight: 700; fill: #294d72; }
      .footer { font-size: 12px; fill: #6a6f75; }
      .label-bg { fill: #f0f2f6; }
      .header-bg { fill: #eef1f5; }
      .row { fill: #ffffff; stroke: #d5dbe2; stroke-width: 1; }
      .rule { stroke: #d5dbe2; stroke-width: 1; }
    </style>
    <rect width="1240" height="1754" fill="#ffffff"/>
    <image x="205" y="28" width="830" height="198" preserveAspectRatio="xMidYMid meet" href="${input.logoDataUri}" xlink:href="${input.logoDataUri}"/>

    <text x="145" y="275" class="title">GARANTNI LIST</text>
    <text x="145" y="316" class="subtitle">Komercijalna garancija za robu</text>

    <text x="145" y="355" class="section">Podaci o davaocu garancije</text>
    <rect x="155" y="374" width="280" height="168" class="label-bg"/>
    ${providerRow(406, "Naziv", GUARANTEE_PROVIDER.name)}
    ${providerRow(448, "Adresa", GUARANTEE_PROVIDER.address)}
    ${providerRow(490, "PIB", GUARANTEE_PROVIDER.pib)}
    ${providerRow(532, "Kontakt za reklamacije", GUARANTEE_PROVIDER.reclamationsEmail)}

    <text x="145" y="570" class="section">Podaci o robi i kupovini</text>
    <rect x="${tableX}" y="${tableY}" width="${tableWidth}" height="${headerHeight}" class="header-bg" stroke="#d5dbe2" stroke-width="1"/>
    ${verticalLines(tableX, tableY, headerHeight, columns)}
    <text x="155" y="611" class="thead">Naziv proizvoda</text>
    <text x="535" y="611" class="thead">Tip proizvoda</text>
    <text x="795" y="611" class="thead">Šifra proizvoda</text>
    <text x="1045" y="611" text-anchor="middle" class="thead">Količina</text>
    ${itemRows}

    <rect x="155" y="${metaY}" width="280" height="84" class="label-bg"/>
    <text x="165" y="${metaY + 29}" class="label">Datum kupovine</text>
    <text x="450" y="${metaY + 29}" class="value">${xmlEscape(formatDate(input.createdAt))}</text>
    <text x="165" y="${metaY + 71}" class="label">Broj porudžbine</text>
    <text x="450" y="${metaY + 71}" class="value">${xmlEscape(input.number)}</text>

    <text x="145" y="${termsY}" class="section">Obim i trajanje garancije</text>
    <text x="145" y="${termsY + 35}" class="body">
      <tspan x="145" dy="0">Garantni rok: ${GUARANTEE_TERM_TEXT}, počev od datuma predaje robe kupcu. Garancija pokriva nedostatke u materijalu i</tspan>
      <tspan x="145" dy="27">izradi koji nastanu pri pravilnoj upotrebi proizvoda, u skladu sa uputstvom proizvođača. Garancija ne pokriva</tspan>
      <tspan x="145" dy="27">oštećenja nastala nepravilnom upotrebom, neovlašćenim popravkama, mehaničkim oštećenjem, neodgovarajućim</tspan>
      <tspan x="145" dy="27">održavanjem ili dejstvom više sile.</tspan>
    </text>

    <text x="145" y="${rightsY}" class="section">Način ostvarivanja prava</text>
    <text x="145" y="${rightsY + 36}" class="body-bold">Podnošenje zahteva:<tspan class="body"> Kupac podnosi zahtev davaocu garancije na gore navedeni kontakt.</tspan></text>
    <text x="145" y="${rightsY + 70}" class="body-bold">Potrebni podaci:<tspan class="body"> Uz zahtev treba dostaviti podatke koji identifikuju proizvod i dokaz o kupovini, kada je potreban za</tspan></text>
    <text x="145" y="${rightsY + 96}" class="body">utvrđivanje datuma i mesta kupovine.</text>
    <text x="145" y="${rightsY + 130}" class="body-bold">Postupanje po zahtevu:<tspan class="body"> Davalac garancije postupa po zahtevu i obaveštava kupca o daljem postupku, uključujući</tspan></text>
    <text x="145" y="${rightsY + 156}" class="body">pregled, popravku, zamenu ili drugo pravo predviđeno uslovima garancije.</text>
    <text x="145" y="${rightsY + 194}" class="section">Važna izjava</text>
    <rect x="155" y="${rightsY + 212}" width="940" height="72" class="header-bg"/>
    <text x="170" y="${rightsY + 242}" class="important">Ova komercijalna garancija ne utiče na zakonska prava potrošača koja ima u slučaju nesaobraznosti robe</text>
    <text x="170" y="${rightsY + 270}" class="important">ugovoru. Ta prava su besplatna i garancija ih ne isključuje niti ograničava.</text>

    <text x="620" y="1700" text-anchor="middle" class="footer">Dokument se predaje kupcu uz potvrdu porudžbine. Sačuvati uz račun ili drugi dokaz o kupovini.</text>
    ${pageLabel}
  </svg>`;
}

function providerRow(y: number, label: string, value: string) {
  return `<text x="165" y="${y}" class="label">${xmlEscape(label)}</text><text x="450" y="${y}" class="value">${xmlEscape(value)}</text>`;
}

function verticalLines(x: number, y: number, height: number, widths: number[]) {
  let cursor = x;
  return widths
    .slice(0, -1)
    .map((width) => {
      cursor += width;
      return `<line x1="${cursor}" y1="${y}" x2="${cursor}" y2="${y + height}" class="rule"/>`;
    })
    .join("");
}

function multilineText(x: number, y: number, lines: string[], className: string) {
  const safeLines = lines.length ? lines : [""];
  return `<text x="${x}" y="${y}" class="${className}">${safeLines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : 19}">${xmlEscape(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function wrapText(value: string, limit: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
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
  return lines;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).format(date);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
