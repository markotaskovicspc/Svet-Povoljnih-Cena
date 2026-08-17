import ExcelJS from "exceljs";

export type RabaluxWeeklyStockRow = {
  sourceSku: string;
  name: string;
  closingStock: number;
  sourceRow: number;
};

export type RabaluxWeeklyStockParseResult = {
  sheetName: string;
  title: string;
  reportDate: string | null;
  headerRow: number;
  validRows: number;
  duplicateRows: number;
  ignoredRows: number;
  rows: RabaluxWeeklyStockRow[];
  errors: string[];
};

const REQUIRED_HEADERS = {
  sku: ["sifraartikla", "sifra", "artikl"],
  name: ["nazivartikla", "naziv"],
  closing: ["krajzaliha", "krajnjazaliha", "stanje"],
} as const;

const OPTIONAL_HEADERS = {
  opening: ["pocetzaliha", "pocetnazaliha"],
  inbound: ["ulazmes", "ulaz"],
  outbound: ["izlazmes", "izlaz"],
} as const;

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  mart: 3,
  april: 4,
  maj: 5,
  jun: 6,
  jul: 7,
  avgust: 8,
  septembar: 9,
  oktobar: 10,
  novembar: 11,
  decembar: 12,
};

export async function parseRabaluxWeeklyStockXlsx(
  bytes: Uint8Array,
): Promise<RabaluxWeeklyStockParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    return emptyResult("XLSX fajl nije moguće pročitati.");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return emptyResult("XLSX fajl nema radni list.");

  const title = findTitle(worksheet);
  const header = findHeader(worksheet);
  if (!header) {
    return {
      ...emptyResult(
        "Nisu pronađene obavezne kolone: Šifra artikla, Naziv artikla i Kraj. zaliha.",
      ),
      sheetName: worksheet.name,
      title,
      reportDate: parseReportDate(title),
    };
  }

  const rowsBySku = new Map<string, RabaluxWeeklyStockRow>();
  const errors: string[] = [];
  let validRows = 0;
  let duplicateRows = 0;
  let ignoredRows = 0;

  for (let rowNumber = header.row + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const sourceSku = normalizeSku(cellText(row.getCell(header.sku)));
    const name = cellText(row.getCell(header.name));
    const closingText = cellText(row.getCell(header.closing));

    if (!sourceSku || sourceSku === "0") {
      ignoredRows++;
      continue;
    }
    if (!name) {
      pushError(errors, `Red ${rowNumber}: nedostaje naziv za šifru ${sourceSku}.`);
      continue;
    }

    const closingStock = integerCell(row.getCell(header.closing));
    if (closingStock === null || closingStock < 0) {
      pushError(
        errors,
        `Red ${rowNumber}: Kraj. zaliha za ${sourceSku} mora biti ceo nenegativan broj (dobijeno: ${closingText || "prazno"}).`,
      );
      continue;
    }

    if (
      header.opening &&
      header.inbound &&
      header.outbound
    ) {
      const opening = integerCell(row.getCell(header.opening));
      const inbound = integerCell(row.getCell(header.inbound));
      const outbound = integerCell(row.getCell(header.outbound));
      if (
        opening !== null &&
        inbound !== null &&
        outbound !== null &&
        opening + inbound - outbound !== closingStock
      ) {
        pushError(
          errors,
          `Red ${rowNumber}: kontrola zalihe ne prolazi za ${sourceSku} (${opening} + ${inbound} - ${outbound} ≠ ${closingStock}).`,
        );
        continue;
      }
    }

    validRows++;
    const existing = rowsBySku.get(sourceSku);
    if (existing) {
      duplicateRows++;
      if (existing.closingStock !== closingStock) {
        pushError(
          errors,
          `Šifra ${sourceSku} je duplirana sa različitim stanjem (${existing.closingStock} i ${closingStock}).`,
        );
      }
      continue;
    }
    rowsBySku.set(sourceSku, {
      sourceSku,
      name,
      closingStock,
      sourceRow: rowNumber,
    });
  }

  return {
    sheetName: worksheet.name,
    title,
    reportDate: parseReportDate(`${title} ${workbook.creator ?? ""}`),
    headerRow: header.row,
    validRows,
    duplicateRows,
    ignoredRows,
    rows: [...rowsBySku.values()].sort((left, right) =>
      left.sourceSku.localeCompare(right.sourceSku, "sr"),
    ),
    errors,
  };
}

export function parseRabaluxStockReportDate(
  title: string,
  fileName = "",
) {
  return parseReportDate(`${title} ${fileName}`);
}

function emptyResult(error: string): RabaluxWeeklyStockParseResult {
  return {
    sheetName: "",
    title: "",
    reportDate: null,
    headerRow: 0,
    validRows: 0,
    duplicateRows: 0,
    ignoredRows: 0,
    rows: [],
    errors: [error],
  };
}

function findTitle(worksheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= Math.min(row.cellCount, 10); column++) {
      const value = cellText(row.getCell(column));
      if (/stanje\s+zaliha/i.test(value)) return value;
    }
  }
  return cellText(worksheet.getCell("A1"));
}

function findHeader(worksheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 30); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const normalized = Array.from(
      { length: Math.max(row.cellCount, 12) },
      (_, index) => normalizeHeader(cellText(row.getCell(index + 1))),
    );
    const sku = findColumn(normalized, REQUIRED_HEADERS.sku);
    const name = findColumn(normalized, REQUIRED_HEADERS.name);
    const closing = findColumn(normalized, REQUIRED_HEADERS.closing);
    if (!sku || !name || !closing) continue;
    return {
      row: rowNumber,
      sku,
      name,
      closing,
      opening: findColumn(normalized, OPTIONAL_HEADERS.opening),
      inbound: findColumn(normalized, OPTIONAL_HEADERS.inbound),
      outbound: findColumn(normalized, OPTIONAL_HEADERS.outbound),
    };
  }
  return null;
}

function findColumn(
  normalized: string[],
  aliases: readonly string[],
) {
  const index = normalized.findIndex((value) => aliases.includes(value));
  return index < 0 ? null : index + 1;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeSku(value: string) {
  const trimmed = value.trim();
  const integerLike = trimmed.match(/^(\d+)\.0+$/);
  return integerLike ? integerLike[1] : trimmed;
}

function cellText(cell: ExcelJS.Cell) {
  if (typeof cell.value === "object" && cell.value && "formula" in cell.value) {
    const result = (cell.value as ExcelJS.CellFormulaValue).result;
    if (typeof result === "number" || typeof result === "string") {
      return String(result).trim();
    }
  }
  return cell.text.trim();
}

function integerCell(cell: ExcelJS.Cell) {
  const value =
    typeof cell.value === "number"
      ? cell.value
      : typeof cell.value === "object" && cell.value && "formula" in cell.value
        ? (cell.value as ExcelJS.CellFormulaValue).result
        : cellText(cell);
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\s\u00a0]/g, "").replace(/([.,])0+$/, "");
  if (!/^-?\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseReportDate(value: string) {
  const numeric = value.match(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4})\b/);
  if (numeric) return isoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  const textual = normalizeDateText(value).match(
    /\b(\d{1,2})\.?\s+(januar|februar|mart|april|maj|jun|jul|avgust|septembar|oktobar|novembar|decembar)\s+(\d{4})\b/,
  );
  if (!textual) return null;
  return isoDate(Number(textual[3]), MONTHS[textual[2]], Number(textual[1]));
}

function normalizeDateText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ђ|đ/g, "d")
    .replace(/ј/g, "j")
    .replace(/а/g, "a")
    .replace(/б/g, "b")
    .replace(/в/g, "v")
    .replace(/г/g, "g")
    .replace(/д/g, "d")
    .replace(/е/g, "e")
    .replace(/ж/g, "z")
    .replace(/з/g, "z")
    .replace(/и/g, "i")
    .replace(/к/g, "k")
    .replace(/л/g, "l")
    .replace(/м/g, "m")
    .replace(/н/g, "n")
    .replace(/о/g, "o")
    .replace(/п/g, "p")
    .replace(/р/g, "r")
    .replace(/с/g, "s")
    .replace(/т/g, "t")
    .replace(/у/g, "u")
    .replace(/ф/g, "f")
    .replace(/х/g, "h")
    .replace(/ц/g, "c")
    .replace(/ч/g, "c")
    .replace(/ш/g, "s");
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function pushError(errors: string[], message: string) {
  if (errors.length < 50) errors.push(message);
}
