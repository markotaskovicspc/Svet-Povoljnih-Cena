import "server-only";

import sharp from "sharp";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { rasterJpegPagesPdf } from "@/lib/pdf/raster-pages";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";

const PAGE_WIDTH = 1754;
const PAGE_HEIGHT = 1240;
const PDF_WIDTH = 842;
const PDF_HEIGHT = 595;
const ITEMS_PER_PAGE = 7;
const COLUMNS = [150, 100, 155, 150, 110, 150, 80, 80, 95, 95, 100, 135, 95, 139];

export type PurchaseOrderPdfInput = {
  number: string;
  orderDate: Date | null;
  loadingDate?: Date | null;
  deliveryDate?: Date | null;
  currency: string;
  totalPrice: number;
  totalVolume: number;
  parity?: string | null;
  notes?: string | null;
  supplier: {
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    paymentTerms?: string | null;
  } | null;
  loadingLocation?: {
    name: string;
    address?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
  items: Array<{
    sku: string;
    name: string;
    supplierProductName?: string | null;
    attributes?: string | null;
    pattern?: string | null;
    packQty?: number | null;
    qty: number;
    purchasePrice: number;
    currency?: string;
    totalVolume: number;
    certificates?: string | null;
    barcode?: string | null;
    imageUrl?: string | null;
  }>;
};

type RenderedItem = PurchaseOrderPdfInput["items"][number] & {
  imageDataUri: string | null;
};

export async function buildPurchaseOrderPdf(order: PurchaseOrderPdfInput) {
  if (!order.items.length) {
    throw new Error("Porudžbenica mora imati bar jednu stavku.");
  }
  const renderedItems = await Promise.all(
    order.items.map(async (item) => ({
      ...item,
      imageDataUri: await loadImageDataUri(item.imageUrl),
    })),
  );
  const pageItems = chunk(renderedItems, ITEMS_PER_PAGE);
  const jpegPages = await Promise.all(
    pageItems.map((items, pageIndex) =>
      sharp(
        Buffer.from(
          purchaseOrderPageSvg(order, items, pageIndex, pageItems.length),
        ),
      )
        .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
        .toBuffer(),
    ),
  );

  return rasterJpegPagesPdf({
    pages: jpegPages,
    pixelWidth: PAGE_WIDTH,
    pixelHeight: PAGE_HEIGHT,
    pdfWidth: PDF_WIDTH,
    pdfHeight: PDF_HEIGHT,
  });
}

async function loadImageDataUri(value: string | null | undefined) {
  const resolved = resolveSupabaseStorageUrl(value);
  if (!resolved) return null;
  try {
    const response = await fetch(resolved, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const image = await sharp(bytes)
      .resize(120, 82, { fit: "contain", background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${image.toString("base64")}`;
  } catch {
    return null;
  }
}

function purchaseOrderPageSvg(
  order: PurchaseOrderPdfInput,
  items: RenderedItem[],
  pageIndex: number,
  pageCount: number,
) {
  const x = 60;
  const tableY = 455;
  const headerHeight = 88;
  const totalHeight = 38;
  const rowHeight = 84;
  const totals = {
    cartons: order.items.reduce(
      (sum, item) => sum + Math.ceil(item.qty / Math.max(item.packQty ?? 1, 1)),
      0,
    ),
    qty: order.items.reduce((sum, item) => sum + item.qty, 0),
    volume: order.items.reduce((sum, item) => sum + item.totalVolume, 0),
    value: order.items.reduce(
      (sum, item) => sum + item.purchasePrice * item.qty,
      0,
    ),
  };
  const headers = [
    "Naziv artikla dobavljača / Item name of producer",
    "SPC šifra artikla / SPC item code",
    "Naziv artikla Svet povoljnih cena / SPC item name",
    "Naziv artikla ili fotografija / Item name or photo",
    "Boja / Color",
    "Način pakovanja / Packaging",
    "Broj kutija / CTN quantity",
    "Količina / Quantity",
    "Jedinica mere / Unit",
    "Ukupna zapremina / Total CBM",
    "Sertifikati / Certificates",
    "Bar kod / Barcode",
    `Cena po jedinici (${order.currency}) / Price per unit`,
    `Ukupna cena (${order.currency}) / Total price`,
  ];

  let cursor = x;
  const headerCells = headers
    .map((header, index) => {
      const width = COLUMNS[index]!;
      const content = centeredMultiline(
        cursor + width / 2,
        tableY + 23,
        wrapText(header, Math.max(8, Math.floor(width / 9))),
        "thead",
        16,
      );
      const cell = `<rect x="${cursor}" y="${tableY}" width="${width}" height="${headerHeight}" class="grid header"/>${content}`;
      cursor += width;
      return cell;
    })
    .join("");

  const totalY = tableY + headerHeight;
  const totalCells = [
    `<rect x="${x}" y="${totalY}" width="815" height="${totalHeight}" class="grid"/><text x="${x + 805}" y="${totalY + 25}" text-anchor="end" class="total">Ukupno / Total</text>`,
    totalCell(x + 815, totalY, 80, totals.cartons),
    totalCell(x + 895, totalY, 80, totals.qty),
    `<rect x="${x + 975}" y="${totalY}" width="95" height="${totalHeight}" class="grid"/>`,
    totalCell(x + 1070, totalY, 95, `${formatNumber(totals.volume, 3)} m³`),
    `<rect x="${x + 1165}" y="${totalY}" width="235" height="${totalHeight}" class="grid"/><text x="${x + 1390}" y="${totalY + 25}" text-anchor="end" class="total-small">Ukupno za plaćanje / Total payment</text>`,
    `<rect x="${x + 1400}" y="${totalY}" width="234" height="${totalHeight}" class="grid"/><text x="${x + 1622}" y="${totalY + 25}" text-anchor="end" class="total">${xmlEscape(order.currency)} ${formatNumber(totals.value, 2)}</text>`,
  ].join("");

  const itemRows = items
    .map((item, index) => {
      const y = totalY + totalHeight + index * rowHeight;
      const cells = [
        item.supplierProductName ?? item.sku,
        item.sku,
        item.name,
        item.name,
        item.pattern ?? "—",
        item.packQty ? `${item.packQty} pcs/box` : "1 pcs/box",
        String(Math.ceil(item.qty / Math.max(item.packQty ?? 1, 1))),
        String(item.qty),
        "piece / kom",
        `${formatNumber(item.totalVolume, 3)} m³`,
        item.certificates ?? "—",
        item.barcode ?? "—",
        formatNumber(item.purchasePrice, 2),
        formatNumber(item.purchasePrice * item.qty, 2),
      ];
      let cellX = x;
      return cells
        .map((value, cellIndex) => {
          const width = COLUMNS[cellIndex]!;
          const image =
            cellIndex === 3 && item.imageDataUri
              ? `<image x="${cellX + 15}" y="${y + 5}" width="${width - 30}" height="${rowHeight - 10}" preserveAspectRatio="xMidYMid meet" href="${item.imageDataUri}"/>`
              : "";
          const text =
            cellIndex === 3 && item.imageDataUri
              ? ""
              : centeredMultiline(
                  cellX + width / 2,
                  y + 27,
                  wrapText(value, Math.max(7, Math.floor(width / 9))),
                  cellIndex >= 6 ? "cell numeric" : "cell",
                  16,
                );
          const rendered = `<rect x="${cellX}" y="${y}" width="${width}" height="${rowHeight}" class="grid"/>${image}${text}`;
          cellX += width;
          return rendered;
        })
        .join("");
    })
    .join("");

  const sellerAddress = [
    order.supplier?.address,
    order.supplier?.city,
    order.supplier?.country,
  ]
    .filter(Boolean)
    .join(", ");
  const loadingPort = [order.loadingLocation?.name, order.loadingLocation?.city]
    .filter(Boolean)
    .join(", ");

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
    <style>
      text { font-family: Arial, Helvetica, sans-serif; fill: #111; }
      .title { font-size: 42px; font-weight: 800; }
      .number { font-size: 36px; font-weight: 800; }
      .label { font-size: 18px; font-weight: 700; }
      .value { font-size: 18px; }
      .term-label { font-size: 17px; font-weight: 700; }
      .term-value { font-size: 16px; }
      .grid { fill: #fff; stroke: #202020; stroke-width: 1.2; }
      .header { fill: #f5f5f5; }
      .thead { font-size: 14px; font-weight: 700; }
      .cell { font-size: 14px; }
      .numeric { font-weight: 600; }
      .total { font-size: 15px; font-weight: 700; }
      .total-small { font-size: 12px; font-weight: 700; }
      .footer { font-size: 12px; fill: #555; }
    </style>
    <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#fff"/>
    <text x="65" y="82" class="title">PORUDŽBENICA / ORDER REQUEST</text>
    <text x="1685" y="82" text-anchor="end" class="number">${xmlEscape(order.number)}</text>

    ${metaRow(66, 145, "Datum porudžbine / Order date", formatDate(order.orderDate ?? new Date()))}
    ${metaRow(66, 180, "Kupac / Buyer", MERCHANT_LEGAL_INFO.name.toUpperCase())}
    ${metaRow(66, 215, "Adresa kupca / Buyer address", MERCHANT_LEGAL_INFO.shortAddress)}
    ${metaRow(66, 250, "PIB kupca / Tax number", MERCHANT_LEGAL_INFO.pib)}
    ${metaRow(66, 285, "Paritet / Incoterm", order.parity ?? "—")}
    ${metaRow(66, 320, "Prodavac / Seller", order.supplier?.name ?? "—")}
    ${sellerAddress ? `<text x="800" y="345" class="value">${xmlEscape(sellerAddress)}</text>` : ""}

    ${termRow(66, 370, "1. Uslovi plaćanja / Terms of payment:", order.supplier?.paymentTerms ?? "—")}
    ${termRow(66, 398, "2. Datum utovara / Loading date", order.loadingDate ? formatDate(order.loadingDate) : "—")}
    ${termRow(66, 426, "3. Luka utovara / Port of loading", loadingPort || "—")}

    ${headerCells}${totalCells}${itemRows}
    ${order.notes ? `<text x="65" y="1200" class="footer">Napomena / Note: ${xmlEscape(order.notes)}</text>` : ""}
    <text x="1688" y="1200" text-anchor="end" class="footer">Strana / Page ${pageIndex + 1}/${pageCount}</text>
  </svg>`;
}

function metaRow(x: number, y: number, label: string, value: string) {
  return `<text x="${x}" y="${y}" class="label">${xmlEscape(label)}</text><text x="800" y="${y}" class="value">${xmlEscape(value)}</text>`;
}

function termRow(x: number, y: number, label: string, value: string) {
  return `<text x="${x}" y="${y}" class="term-label">${xmlEscape(label)}</text><text x="800" y="${y}" class="term-value">${xmlEscape(value)}</text>`;
}

function totalCell(x: number, y: number, width: number, value: string | number) {
  return `<rect x="${x}" y="${y}" width="${width}" height="38" class="grid"/><text x="${x + width / 2}" y="${y + 25}" text-anchor="middle" class="total">${xmlEscape(String(value))}</text>`;
}

function centeredMultiline(
  x: number,
  y: number,
  lines: string[],
  className: string,
  lineHeight: number,
) {
  return `<text x="${x}" y="${y}" text-anchor="middle" class="${className}">${lines
    .slice(0, 4)
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${xmlEscape(line)}</tspan>`,
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

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).format(value);
}

function formatNumber(value: number, digits: number) {
  return new Intl.NumberFormat("sr-Latn-RS", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace(/\u00a0/g, " ");
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
