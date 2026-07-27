import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseOpeningInventoryFile } from "@/lib/inventory-file";

describe("opening inventory files", () => {
  it("reads an XLSX stock table from its first worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("DC");
    sheet.addRow(["Šifra", "Stanje"]);
    sheet.addRow(["RAB-123", 7]);
    const bytes = await workbook.xlsx.writeBuffer();

    const result = await parseOpeningInventoryFile({
      name: "dc-stanje.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new Uint8Array(bytes),
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        line: 2,
        sku: "RAB-123",
        qty: 7,
        widthCm: null,
        depthCm: null,
        heightCm: null,
      },
    ]);
  });

  it("rejects unsupported legacy spreadsheet formats", async () => {
    const result = await parseOpeningInventoryFile({
      name: "dc-stanje.xls",
      type: "application/vnd.ms-excel",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.errors.join(" ")).toMatch(/CSV i XLSX/);
  });

  it("returns a validation error for a corrupt XLSX file", async () => {
    const result = await parseOpeningInventoryFile({
      name: "osteceno-stanje.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.errors).toEqual(["XLSX fajl nije moguće pročitati."]);
  });
});
