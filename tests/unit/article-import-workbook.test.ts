import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_IMPORT_TEMPLATE_HEADERS,
  findArticleImportWorksheet,
} from "@/lib/admin/article-import-workbook";

describe("article import workbook discovery", () => {
  it("finds the article sheet and a header row that is not first", () => {
    const workbook = new ExcelJS.Workbook();
    const summary = workbook.addWorksheet("Export Summary");
    summary.addRow(["Izveštaj", "Broj redova"]);
    summary.addRow(["Kratki naziv", 8]);

    const articles = workbook.addWorksheet("Sheet1");
    articles.addRow(["Izvoz artikala"]);
    articles.addRow([]);
    articles.addRow([
      "Šifra",
      "Kratki naziv",
      "Zemlja porekla",
      "Tarifni broj",
    ]);
    articles.addRow(["210026", "Barska stolica", "CN", "94032080"]);

    const selected = findArticleImportWorksheet(workbook);

    expect(selected?.worksheet.name).toBe("Sheet1");
    expect(selected?.headerRow).toBe(3);
    expect(selected?.headers.get("countryOfOrigin")).toBe(3);
    expect(selected?.headers.get("hsCode")).toBe(4);
    expect(selected?.recognizedColumns).toEqual([
      "Šifra",
      "Kratki naziv",
      "Zemlja porekla",
      "Tarifni broj",
    ]);
  });

  it("keeps a useful first-sheet fallback when no supported headers exist", () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Podaci").addRow(["Nepoznata kolona"]);

    const selected = findArticleImportWorksheet(workbook);

    expect(selected?.worksheet.name).toBe("Podaci");
    expect(selected?.headerRow).toBe(1);
    expect(selected?.headers.size).toBe(0);
  });

  it("ships origin and tariff columns in the downloadable template", () => {
    expect(ARTICLE_IMPORT_TEMPLATE_HEADERS).toContain("Zemlja porekla");
    expect(ARTICLE_IMPORT_TEMPLATE_HEADERS).toContain("Tarifni broj");
  });
});
