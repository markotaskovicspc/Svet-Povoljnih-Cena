import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  parseRabaluxStockReportDate,
  parseRabaluxWeeklyStockXlsx,
} from "@/lib/rabalux/weekly-stock-file";

async function workbookBytes(
  rows: Array<{
    sku: string | number | ExcelJS.CellFormulaValue;
    name: string;
    opening: number;
    inbound: number;
    outbound: number;
    closing: number;
  }>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("16. Avg_Stanje");
  sheet.getCell("A1").value = "📊 STANJE ZALIHA — 16. Avgust 2026";
  sheet.getRow(3).values = [
    "#",
    "Šifra artikla",
    "Naziv artikla",
    "Jed. mere",
    "Počet. zaliha",
    "Ulaz (mes.)",
    "Izlaz (mes.)",
    "Kraj. zaliha",
    "Lokacija u mag.",
    "Napomena",
  ];
  rows.forEach((item, index) => {
    const row = sheet.getRow(index + 4);
    row.values = [
      index + 1,
      item.sku,
      item.name,
      "kom",
      item.opening,
      item.inbound,
      item.outbound,
      item.closing,
      "",
      "",
    ];
  });
  sheet.getCell(`C${rows.length + 5}`).value = "UKUPNO";
  sheet.getCell(`H${rows.length + 5}`).value = {
    formula: `SUM(H4:H${rows.length + 3})`,
    result: rows.reduce((sum, row) => sum + row.closing, 0),
  };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("Rabalux weekly XLSX parser", () => {
  it("reads cached formula SKU values, validates movement and collapses equal duplicates", async () => {
    const bytes = await workbookBytes([
      {
        sku: { formula: "'[catalog.xlsx]Sheet1'!A2", result: 1046 },
        name: "Lampa",
        opening: 2,
        inbound: 3,
        outbound: 1,
        closing: 4,
      },
      {
        sku: "1046",
        name: "Lampa duplikat",
        opening: 4,
        inbound: 0,
        outbound: 0,
        closing: 4,
      },
      {
        sku: "210.025",
        name: "SKU sa tačkom",
        opening: 0,
        inbound: 1,
        outbound: 0,
        closing: 1,
      },
    ]);

    const parsed = await parseRabaluxWeeklyStockXlsx(bytes);

    expect(parsed.errors).toEqual([]);
    expect(parsed).toMatchObject({
      sheetName: "16. Avg_Stanje",
      reportDate: "2026-08-16",
      headerRow: 3,
      validRows: 3,
      duplicateRows: 1,
    });
    expect(parsed.rows).toEqual([
      { sourceSku: "1046", name: "Lampa", closingStock: 4, sourceRow: 4 },
      {
        sourceSku: "210.025",
        name: "SKU sa tačkom",
        closingStock: 1,
        sourceRow: 6,
      },
    ]);
  });

  it("rejects conflicting duplicate quantities", async () => {
    const parsed = await parseRabaluxWeeklyStockXlsx(
      await workbookBytes([
        { sku: "A", name: "Prvi", opening: 1, inbound: 0, outbound: 0, closing: 1 },
        { sku: "A", name: "Drugi", opening: 2, inbound: 0, outbound: 0, closing: 2 },
      ]),
    );
    expect(parsed.errors).toContain("Šifra A je duplirana sa različitim stanjem (1 i 2).");
  });

  it("rejects a row whose opening and movements do not reconcile to closing stock", async () => {
    const parsed = await parseRabaluxWeeklyStockXlsx(
      await workbookBytes([
        { sku: "A", name: "Pogrešno", opening: 1, inbound: 2, outbound: 0, closing: 9 },
      ]),
    );
    expect(parsed.errors[0]).toContain("kontrola zalihe ne prolazi");
  });

  it("accepts the numeric report date from the supplied file name", () => {
    expect(
      parseRabaluxStockReportDate("STANJE ZALIHA", "Rabalux stanje_16.08.2026.xlsx"),
    ).toBe("2026-08-16");
  });
});
