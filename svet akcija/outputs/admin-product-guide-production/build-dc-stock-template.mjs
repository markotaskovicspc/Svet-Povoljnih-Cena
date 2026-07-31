import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = `${path.dirname(fileURLToPath(import.meta.url))}/`;
const workbook = Workbook.create();

const stock = workbook.worksheets.add("DC lager");
stock.showGridLines = false;
stock.freezePanes.freezeRows(1);
stock.getRange("A1:E2").values = [
  ["sku", "qty", "widthCm", "depthCm", "heightCm"],
  ["NOV-2026-00004", 7, 15, 15, 38],
];
stock.getRange("A1:E1").format = {
  fill: "#173B5E",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#173B5E" },
};
stock.getRange("A2:E2").format = {
  fill: "#F5F7FA",
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#D9E1E8" },
};
stock.getRange("B2:E2").format.numberFormat = "0";
stock.getRange("A1:A2").format.columnWidth = 22;
stock.getRange("B1:B2").format.columnWidth = 10;
stock.getRange("C1:E2").format.columnWidth = 14;
stock.getRange("A1:E2").format.rowHeight = 24;

const guide = workbook.worksheets.add("Uputstvo");
guide.showGridLines = false;
guide.getRange("A1:B7").values = [
  ["DC lager — kratko uputstvo", ""],
  ["1", "Ne menjajte nazive kolona sku i qty."],
  ["2", "Jedan proizvod ide u jedan red."],
  ["3", "sku je šifra proizvoda iz admina."],
  ["4", "qty je novo ukupno fizičko stanje u DC magacinu."],
  ["5", "widthCm, depthCm i heightCm su opcione dimenzije u centimetrima."],
  ["6", "U adminu otvorite DC lager → izaberite fajl → Proveri fajl → Potvrdi uvoz."],
];
guide.getRange("A1:B1").merge();
guide.getRange("A1:B1").format = {
  fill: "#173B5E",
  font: { bold: true, color: "#FFFFFF", size: 15 },
  verticalAlignment: "center",
};
guide.getRange("A2:A7").format = {
  fill: "#DDEAF4",
  font: { bold: true, color: "#173B5E" },
  horizontalAlignment: "center",
};
guide.getRange("B2:B7").format = {
  fill: "#F5F7FA",
  wrapText: true,
  verticalAlignment: "center",
};
guide.getRange("A1:A7").format.columnWidth = 8;
guide.getRange("B1:B7").format.columnWidth = 72;
guide.getRange("A1:B1").format.rowHeight = 32;
guide.getRange("A2:B7").format.rowHeight = 30;

const stockPreview = await workbook.render({
  sheetName: "DC lager",
  range: "A1:E2",
  scale: 2,
  format: "png",
});
await fs.writeFile(
  `${outputDir}dc-stock-preview.png`,
  new Uint8Array(await stockPreview.arrayBuffer()),
);

const guidePreview = await workbook.render({
  sheetName: "Uputstvo",
  range: "A1:B7",
  scale: 2,
  format: "png",
});
await fs.writeFile(
  `${outputDir}dc-stock-guide-preview.png`,
  new Uint8Array(await guidePreview.arrayBuffer()),
);

const inspect = await workbook.inspect({
  kind: "table",
  range: "DC lager!A1:E2",
  include: "values,formulas",
  tableMaxRows: 5,
  tableMaxCols: 8,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}SPC_DC_zaliha_TEST_NOV-2026-00004_artifact.xlsx`);
