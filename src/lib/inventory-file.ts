import ExcelJS from "exceljs";
import {
  parseOpeningInventoryCsv,
  parseOpeningInventoryTable,
  type OpeningInventoryParseResult,
} from "@/lib/inventory-csv";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function parseOpeningInventoryFile(input: {
  name: string;
  type?: string;
  bytes: Uint8Array;
}): Promise<OpeningInventoryParseResult> {
  const lowerName = input.name.toLowerCase();
  if (lowerName.endsWith(".xlsx") || input.type === XLSX_MIME) {
    return parseOpeningInventoryXlsx(input.bytes);
  }
  if (
    lowerName.endsWith(".csv") ||
    input.type === "text/csv" ||
    input.type === "text/plain" ||
    !input.type
  ) {
    return parseOpeningInventoryCsv(Buffer.from(input.bytes).toString("utf8"));
  }
  return {
    rows: [],
    errors: ["Podržani su samo CSV i XLSX fajlovi."],
  };
}

export async function parseOpeningInventoryXlsx(
  bytes: Uint8Array,
): Promise<OpeningInventoryParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    return { rows: [], errors: ["XLSX fajl nije moguće pročitati."] };
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { rows: [], errors: ["XLSX fajl nema radni list."] };
  }
  const table: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let index = 1; index <= row.cellCount; index += 1) {
      cells.push(row.getCell(index).text.trim());
    }
    table.push(cells);
  });
  return parseOpeningInventoryTable(table);
}
