import "server-only";

import { db } from "@/lib/db";
import { DISPATCH_SHIPMENT_METHODS } from "@/lib/admin/dispatch-note";
import { renderPdfSvgToJpeg } from "@/lib/pdf/render-svg";
import { rasterJpegPagesPdf } from "@/lib/pdf/raster-pages";

export async function getDispatchNotePrintData(id: string) {
  return db.dispatchNote.findUnique({
    where: { id },
    include: {
      sourceWarehouse: true,
      destinationWarehouse: true,
      items: {
        orderBy: { id: "asc" },
        include: { product: { select: { barcode: true } } },
      },
    },
  });
}

export type DispatchNotePrintData = NonNullable<Awaited<ReturnType<typeof getDispatchNotePrintData>>>;
const WIDTH = 595;
const HEIGHT = 842;
const MARGIN = 40;
const TABLE_WIDTH = WIDTH - 2 * MARGIN;
const TABLE_BOTTOM = 685;
const LINE_HEIGHT = 11;
const DATE_FORMATTER = new Intl.DateTimeFormat("sr-Latn-RS", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Belgrade",
});

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function money(value: unknown) {
  return Number(value).toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).replace(/\u00a0/g, " ");
}

/** Conservative wrapping, including long unbroken SKUs/addresses, never ellipsizes data. */
function wrap(value: string, width: number, size = 9) {
  const limit = Math.max(1, Math.floor(width / (size * 0.6)));
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    for (let start = 0; start < word.length; start += limit) {
      const piece = word.slice(start, start + limit);
      if (line && `${line} ${piece}`.length > limit) { lines.push(line); line = ""; }
      line = line ? `${line} ${piece}` : piece;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function text(x: number, y: number, lines: string[], size = 9, bold = false, anchor = "start", color = "#111") {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold ? 700 : 400}" text-anchor="${anchor}" fill="${color}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? LINE_HEIGHT : 0}">${xml(line)}</tspan>`).join("")}</text>`;
}

type Column = { label: string; width: number; align?: "center" | "right" };
type Row = { cells: string[][]; height: number; continuation: boolean };
type Page = { header: string; tableY: number; rows: Row[]; tail: string[]; tailY: number };

function metadata(note: DispatchNotePrintData) {
  let y = 111;
  let content = "";
  const row = (label: string, value: string) => {
    const lines = wrap(value, 380);
    content += text(MARGIN, y, [label]) + text(175, y, lines);
    y += Math.max(24, lines.length * LINE_HEIGHT + 9);
  };
  row("Broj otpremnice:", note.number);
  row("Datum:", DATE_FORMATTER.format(note.issueDate));
  row("Pošiljalac:", `${note.issuerName}, PIB: ${note.issuerPib}, MB: ${note.issuerRegistrationNumber}`);
  row("Adresa pošiljaoca:", `${note.issuerAddress}, ${note.issuerPostalCode} ${note.issuerCity}`);
  row("Primalac:", `${note.receiverName}, PIB: ${note.receiverPib}, MB: ${note.receiverRegistrationNumber}`);
  row("Adresa primaoca:", `${note.receiverAddress}, ${note.receiverPostalCode} ${note.receiverCity}`);
  const warehouse = `${note.sourceWarehouse.code} - ${note.sourceWarehouse.name}`;
  row("Magacin:", note.type === "INTERNAL" && note.destinationWarehouse
    ? `${warehouse} → ${note.destinationWarehouse.code} - ${note.destinationWarehouse.name}` : warehouse);
  const method = DISPATCH_SHIPMENT_METHODS.find(item => item.value === note.shipmentMethod)?.label ?? String(note.shipmentMethod);
  const transport = note.shipmentMethod <= 3
    ? [method, note.carrierName, note.licensePlate].filter(Boolean).join(" / ")
    : [method, [note.courierFirstName, note.courierLastName].filter(Boolean).join(" "), note.courierIdNumber ? `Lična karta: ${note.courierIdNumber}` : ""].filter(Boolean).join(" / ");
  row("Transport:", transport);
  return { content, tableY: y + 9 };
}

function itemDescription(item: DispatchNotePrintData["items"][number]) {
  return [
    item.subgroup ? `Podgrupa: ${item.subgroup}` : "",
    item.collection ? `Kolekcija: ${item.collection}` : "",
    item.shortDescription ? `Opis: ${item.shortDescription}` : "",
    [item.attribute1, item.attribute2, item.attribute3, item.attribute4].filter(Boolean).join(" / "),
    [item.color1, item.color2].filter(Boolean).join(" / "),
    item.palletQty ? `Komada na paleti: ${item.palletQty}` : "",
    item.sourceOrderNumber ? `Porudžbina: ${item.sourceOrderNumber}` : "",
  ].filter(Boolean).join(" | ");
}

/** A4 table layout inspired by the supplied assortment dispatch note. */
export function dispatchNotePagesSvg(note: DispatchNotePrintData) {
  const prices = note.type !== "INTERNAL" && note.showPrices;
  const columns: Column[] = prices ? [
    { label: "Redni broj", width: 35, align: "center" },
    { label: "ACODE", width: 78, align: "center" },
    { label: "SKU", width: 60, align: "center" },
    { label: "Naziv artikla", width: 174 },
    { label: "Količina", width: 45, align: "center" },
    { label: `Cena (${note.currency})`, width: 60, align: "right" },
    { label: `Ukupno (${note.currency})`, width: 63, align: "right" },
  ] : [
    { label: "Redni broj", width: 55, align: "center" },
    { label: "ACODE", width: 85, align: "center" },
    { label: "SKU", width: 65, align: "center" },
    { label: "Naziv artikla", width: 245 },
    { label: "Količina", width: 65, align: "center" },
  ];
  const firstHeader = metadata(note);
  const pages: Page[] = [{ header: firstHeader.content, tableY: firstHeader.tableY, rows: [], tail: [], tailY: 0 }];
  const current = () => pages[pages.length - 1]!;
  const endY = () => current().tableY + 28 + current().rows.reduce((sum, row) => sum + row.height, 0);
  const nextPage = () => pages.push({ header: "", tableY: 100, rows: [], tail: [], tailY: 0 });

  for (const [index, item] of note.items.entries()) {
    const description = itemDescription(item);
    const values = [String(index + 1), item.product?.barcode ?? "", item.sku,
      [item.shortName ?? item.name, description].filter(Boolean).join("\n"), String(item.qty),
      ...(prices ? [money(item.unitPriceGross), money(item.totalGross)] : [])];
    const cells = values.map((value, column) => value.split("\n").flatMap(part => wrap(part, columns[column]!.width - 12, 8)));
    let remaining = Math.max(...cells.map(cell => cell.length));
    let offset = 0;
    while (remaining > 0) {
      let available = TABLE_BOTTOM - endY();
      if (available < 25) { nextPage(); available = TABLE_BOTTOM - endY(); }
      const lines = Math.min(remaining, Math.floor((available - 12) / LINE_HEIGHT));
      const rowCells = cells.map(cell => cell.slice(offset, offset + lines));
      if (offset) rowCells[0] = [`${index + 1}. nast.`];
      current().rows.push({ cells: rowCells, height: Math.max(25, lines * LINE_HEIGHT + 12), continuation: offset > 0 });
      offset += lines;
      remaining -= lines;
      if (remaining > 0) nextPage();
    }
  }

  // Provide writing space like the reference, while reserving room for totals and notes.
  const tailLines = [
    ...(prices ? [`Vrednost bez PDV-a: ${money(note.totalNet)} ${note.currency}`, `PDV: ${money(note.totalVat)} ${note.currency}`, `Vrednost sa PDV-om: ${money(note.totalGross)} ${note.currency}`] : []),
    ...(note.notes ? wrap(`Napomena: ${note.notes}`, TABLE_WIDTH, 9) : []),
  ];
  if (pages.length === 1) {
    const reserve = Math.min(tailLines.length * LINE_HEIGHT + 15, 90);
    while (current().rows.length < 16 && endY() + 25 <= TABLE_BOTTOM - reserve) {
      const number = current().rows.length + 1;
      current().rows.push({ cells: [[String(number)], ...columns.slice(1).map(() => [""])], height: 25, continuation: false });
    }
  }
  current().tailY = endY() + 17;
  for (const line of tailLines) {
    if (current().tailY + current().tail.length * LINE_HEIGHT > 721) {
      nextPage(); current().tailY = 105;
    }
    current().tail.push(line);
  }

  return pages.map((page, pageIndex) => {
    let grid = "";
    let x = MARGIN;
    if (page.rows.length) {
      for (const column of columns) {
        grid += `<rect x="${x}" y="${page.tableY}" width="${column.width}" height="28" fill="#19647e" stroke="#111" stroke-width="0.6"/>`;
        const lines = wrap(column.label, column.width - 6, 8);
        grid += text(x + column.width / 2, page.tableY + (lines.length > 1 ? 10 : 17), lines, 8, true, "middle", "#fff");
        x += column.width;
      }
      let y = page.tableY + 28;
      for (const row of page.rows) {
        x = MARGIN;
        for (const [index, column] of columns.entries()) {
          grid += `<rect x="${x}" y="${y}" width="${column.width}" height="${row.height}" fill="#fff" stroke="#111" stroke-width="0.6"/>`;
          const anchor = column.align === "center" ? "middle" : column.align === "right" ? "end" : "start";
          const tx = column.align === "center" ? x + column.width / 2 : column.align === "right" ? x + column.width - 6 : x + 6;
          grid += text(tx, y + 16, row.cells[index] ?? [], 8, false, anchor);
          x += column.width;
        }
        y += row.height;
      }
    }
    const heading = `Otpremnica ${note.number}`;
    const titleSize = Math.min(22, 380 / (heading.length * 0.58));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1190" height="1684" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>
      <g font-family="Geist">
        <rect x="${MARGIN}" y="49" width="88" height="25" fill="#d9e8f7"/>
        ${text(MARGIN + 44, 65, [note.type === "INTERNAL" ? "Interni prenos" : "Dobavljač"], 8, true, "middle")}
        ${text(330, 69, [heading], titleSize, true, "middle")}
        ${page.header}${grid}
        ${text(MARGIN, page.tailY, page.tail, 9)}
        ${text(MARGIN, 752, ["Robu izdao"], 9)}
        ${text(WIDTH - MARGIN, 752, ["Robu primio"], 9, false, "end")}
        <path d="M ${MARGIN} 798 H 255 M 340 798 H ${WIDTH - MARGIN}" stroke="#111" stroke-width="0.6"/>
        ${text(WIDTH - MARGIN, 825, [`Strana ${pageIndex + 1} / ${pages.length}`], 8, false, "end", "#555")}
      </g>
    </svg>`;
  });
}

export async function buildDispatchNotePdf(note: DispatchNotePrintData) {
  const pages: Buffer[] = [];
  for (const svg of dispatchNotePagesSvg(note)) pages.push(await renderPdfSvgToJpeg(svg));
  return rasterJpegPagesPdf({ pages, pixelWidth: 1190, pixelHeight: 1684, pdfWidth: WIDTH, pdfHeight: HEIGHT });
}
