import { describe, expect, it } from "vitest";
import { parsePurchaseOrderImportCsv, parsePurchaseOrderImportRows } from "@/lib/admin/purchase-order-import";

describe("purchase order import parser", () => {
  it("preserves leading zero SKUs, BOM, quoted delimiters and source row numbers", () => {
    expect(parsePurchaseOrderImportCsv('\uFEFFŠifra;Količina\r\n"001;02";12\r\n\r\n0003;4')).toEqual([{ row: 2, sku: "001;02", qty: 12 }, { row: 4, sku: "0003", qty: 4 }]);
  });
  it("accepts tab-separated Cyrillic headers and reversed columns", () => {
    expect(parsePurchaseOrderImportCsv("Количина\tШифра\n2\tAB")).toEqual([{ row: 2, sku: "AB", qty: 2 }]);
  });
  it.each(["0", "-1", "1.5", "1,5", "1e3", "1000001", "", "Infinity"])("rejects invalid quantity %s", qty => {
    expect(() => parsePurchaseOrderImportRows([["SKU", "qty"], ["A", qty]])).toThrow(/količina/);
  });
  it("rejects missing SKU", () => expect(() => parsePurchaseOrderImportCsv("sku,qty\n,2")).toThrow(/šifru/));
  it("rejects case-insensitive duplicate SKUs instead of doubling quantities", () => expect(() => parsePurchaseOrderImportCsv("sku,qty\nA,2\na,3")).toThrow(/duplirana/));
  it("rejects repeated header aliases", () => expect(() => parsePurchaseOrderImportCsv("sku,sifra,qty\nA,A,2")).toThrow(/po jednu/));
  it("rejects empty sheets and >500 rows", () => {
    expect(() => parsePurchaseOrderImportCsv("sku,qty\n")).toThrow(/od 1 do 500/);
    expect(() => parsePurchaseOrderImportRows([["sku", "qty"], ...Array.from({ length: 501 }, (_, i) => [String(i), "1"])])).toThrow(/od 1 do 500/);
  });
  it("rejects unclosed CSV quotes", () => expect(() => parsePurchaseOrderImportCsv('sku,qty\n"A,2')).toThrow(/navodnici/));
});
