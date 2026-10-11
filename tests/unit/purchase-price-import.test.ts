import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { normalizeImportedPurchasePrice, parsePurchasePriceCsv, parsePurchasePriceImportRows } from "@/lib/admin/purchase-price-import";
import { readPurchasePriceImportFile } from "@/lib/admin/purchase-price-import.server";

const header = ["Šifra", "Nabavna cena", "Važenje od", "Važenje do", "Valuta", "Dobavljač"];

describe("purchase price import parsing", () => {
  it.each([["1.234,56", "1234.56"], ["1234.56", "1234.56"], ["1 234,56", "1234.56"], ["0", "0"], ["1.234", "1234"], ["9.999.999.999,99", "9999999999.99"]])("accepts localized monetary value %s", (input, output) => {
    expect(normalizeImportedPurchasePrice(input)).toBe(output);
  });
  it.each(["1,234.56", "12 34", "1e3", "-1", "1.2345", "10000000000", "NaN", "", "=1+2"])("rejects ambiguous or invalid monetary value %s", value => {
    expect(() => normalizeImportedPurchasePrice(value)).toThrow();
  });
  it("accepts BOM, quoted semicolons, quoted decimal comma and Serbian dates", () => {
    const rows = parsePurchasePriceCsv('\uFEFFŠifra;Nabavna cena;Važenje od;Važenje do;Valuta;Dobavljač\r\n"A;01";"123,45";1.2.2030.;28.2.2030;eur;"Dobavljač ""Prvi"""\r\n');
    expect(rows).toEqual([{ row: 2, sku: "A;01", purchasePrice: "123.45", validFrom: "2030-02-01", validTo: "2030-02-28", currency: "EUR", supplier: 'Dobavljač "Prvi"', errors: [] }]);
  });
  it("accepts comma-delimited CSV with quoted decimal comma", () => {
    expect(parsePurchasePriceCsv('sku,purchasePrice,validFrom\nABC,"12,30",2030-01-01')[0].purchasePrice).toBe("12.30");
  });
  it("reports each invalid row and marks both duplicate SKU/date rows", () => {
    const rows = parsePurchasePriceImportRows([header, ["A", "12", "2030-01-01"], ["a", "13", "2030-01-01"], ["B", "-1", "2030-02-30", "", "GBP"], ["C", "5", "2030-02-01", "2030-01-01"]]);
    expect(rows[0].errors.join()).toMatch(/Duplirana/);
    expect(rows[1].errors.join()).toMatch(/Duplirana/);
    expect(rows[2].errors).toHaveLength(3);
    expect(rows[3].errors.join()).toMatch(/pre datuma/);
  });
  it("allows multiple different dates per product", () => {
    expect(parsePurchasePriceImportRows([header, ["A", "12", "2030-01-01"], ["A", "13", "2030-02-01"]]).every(row => row.errors.length === 0)).toBe(true);
  });
  it("rejects missing/duplicate headers, empty input, unclosed quotes and oversize rows", () => {
    expect(() => parsePurchasePriceCsv("Šifra;Cena\nA;1")).toThrow(/Obavezne kolone/);
    expect(() => parsePurchasePriceImportRows([[...header, "sku"], ["A", "1", "2030-01-01"]])).toThrow(/duplirane kolone/);
    expect(() => parsePurchasePriceImportRows([header])).toThrow(/od 1 do 500/);
    expect(() => parsePurchasePriceCsv('sku,purchasePrice,validFrom\n"A,1,2030-01-01')).toThrow(/Nezatvoreni/);
    expect(() => parsePurchasePriceImportRows([header, ...Array.from({ length: 501 }, () => ["A", "1", "2030-01-01"])] )).toThrow(/od 1 do 500/);
  });
  it("reads Excel dates and preserves zero-prefixed text SKU", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Cene"); sheet.addRow(header); sheet.addRow(["0012", 12.5, new Date("2030-01-01T00:00:00.000Z")]);
    const parsed = await readPurchasePriceImportFile(new File([await workbook.xlsx.writeBuffer() as ArrayBuffer], "cene.xlsx"));
    expect(parsed.rows[0]).toMatchObject({ sku: "0012", purchasePrice: "12.5", validFrom: "2030-01-01", errors: [] });
  });
  it("rejects formulas, multiple data sheets, unsupported files and oversized files", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Cene"); sheet.addRow(header); sheet.addRow(["A", { formula: "1+1", result: 2 }, "2030-01-01"]);
    await expect(readPurchasePriceImportFile(new File([await workbook.xlsx.writeBuffer() as ArrayBuffer], "cene.xlsx"))).rejects.toThrow(/formule nisu dozvoljene/);
    sheet.getCell("B2").value = 2; workbook.addWorksheet("Druge cene").addRow(header);
    await expect(readPurchasePriceImportFile(new File([await workbook.xlsx.writeBuffer() as ArrayBuffer], "cene.xlsx"))).rejects.toThrow(/tačno jedan/);
    await expect(readPurchasePriceImportFile(new File(["a"], "cene.xls"))).rejects.toThrow(/samo CSV i XLSX/);
    await expect(readPurchasePriceImportFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "cene.csv"))).rejects.toThrow(/2 MB/);
  });
});
