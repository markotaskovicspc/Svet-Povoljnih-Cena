import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve(".");
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Artikli");

const headers = [
  "SKU",
  "Kratki naziv",
  "Status artikla",
  "Dobavljač",
  "Kategorija",
  "Grupa",
  "Podgrupa",
  "Kolekcija",
  "Kratki opis",
  "Atribut 1",
  "Atribut 2",
  "Atribut 3",
  "Atribut 4",
  "Boja 1",
  "Boja 2",
  "Benefiti",
  "Opis za sajt",
  "Zalihe",
  "Širina cm",
  "Dubina cm",
  "Visina cm",
  "Težina kg",
  "Bruto težina kg",
  "Kom/pak",
  "Pak širina cm",
  "Pak dubina cm",
  "Pak visina cm",
  "Pak bruto kg",
  "Dobavljačev naziv",
  "Material",
  "Sertifikati",
  "Bar kod",
  "HS kod",
  "Carina",
  "Ananas posred",
  "Ananas skladiš",
  "Ananas ispor",
  "Web check",
  "VP check",
  "INO check",
  "MOQ",
  "Novo do",
];

const sampleRow = [
  "",
  "NORD EXCEL",
  "UZ",
  "TEST DOBAVLJAČ UPUTSTVO",
  "Sve za kuću",
  "TEST UPUTSTVO",
  "",
  "TEST",
  "Stona LED lampa sa tri nivoa osvetljenja",
  "LED 8W",
  "USB-C",
  "3 nivoa osvetljenja",
  "Toplo belo svetlo",
  "Teget plava",
  "Krem",
  "Niska potrošnja, podesiv ugao, jednostavno održavanje",
  "Test proizvod za vežbu unosa u admin panel. Nije namenjen stvarnoj prodaji.",
  8,
  15,
  15,
  38,
  0.8,
  1.1,
  1,
  20,
  20,
  45,
  1.3,
  "TEST NORD LED TABLE LAMP",
  "Metal, drvo i tekstil",
  "CE, RoHS",
  "2000000000022",
  "9405.20",
  10,
  10,
  2,
  8,
  "Ne",
  "Ne",
  "Ne",
  1,
  new Date("2026-08-30T00:00:00.000Z"),
];

sheet.getRange("A1:AP2").values = [headers, sampleRow];
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.freezePanes.freezeColumns(2);

sheet.getRange("A1:AP1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 10 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#15324D" },
};
sheet.getRange("A2:AP2").format = {
  fill: "#F7FAFC",
  font: { color: "#172B4D", size: 10 },
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "inside", style: "thin", color: "#D9E2F3" },
};
sheet.getRange("A1:AP2").format.rowHeight = 48;
sheet.getRange("A2:AP2").format.rowHeight = 66;

for (const [range, fill] of [
  ["A1:H1", "#1F4E78"],
  ["I1:Q1", "#7F6000"],
  ["R1:R1", "#548235"],
  ["S1:AB1", "#0F6B78"],
  ["AC1:AK1", "#9E480E"],
  ["AL1:AP1", "#5B5B5B"],
]) {
  sheet.getRange(range).format.fill = fill;
}

const widths = {
  A: 17, B: 20, C: 15, D: 26, E: 20, F: 18, G: 18, H: 15,
  I: 38, J: 21, K: 18, L: 23, M: 20, N: 16, O: 14, P: 38, Q: 48,
  R: 11, S: 12, T: 12, U: 12, V: 12, W: 15, X: 10, Y: 14,
  Z: 14, AA: 14, AB: 14, AC: 28, AD: 25, AE: 18, AF: 18, AG: 14,
  AH: 10, AI: 14, AJ: 14, AK: 14, AL: 12, AM: 12, AN: 12, AO: 8, AP: 13,
};
for (const [column, width] of Object.entries(widths)) {
  sheet.getRange(`${column}1:${column}2`).format.columnWidth = width;
}

sheet.getRange("A2:A2").format.numberFormat = "@";
sheet.getRange("AF2:AG2").format.numberFormat = "@";
sheet.getRange("R2:R2").format.numberFormat = "0";
sheet.getRange("S2:W2").format.numberFormat = "0.00";
sheet.getRange("X2:X2").format.numberFormat = "0";
sheet.getRange("Y2:AB2").format.numberFormat = "0.00";
sheet.getRange("AH2:AK2").format.numberFormat = "0.00";
sheet.getRange("AO2:AO2").format.numberFormat = "0";
sheet.getRange("AP2:AP2").format.numberFormat = "yyyy-mm-dd";

sheet.getRange("C2:C200").dataValidation = {
  rule: { type: "list", values: ["SP", "IT", "DTZ", "DOB", "ARH", "UZ"] },
};
for (const range of ["AL2:AL200", "AM2:AM200", "AN2:AN200"]) {
  sheet.getRange(range).dataValidation = {
    rule: { type: "list", values: ["Da", "Ne"] },
  };
}

const instructions = workbook.worksheets.add("Uputstvo");
instructions.showGridLines = false;
instructions.getRange("A1:F1").values = [[
  "Kako se koristi ovaj Excel fajl",
  null,
  null,
  null,
  null,
  null,
]];
instructions.getRange("A1:F1").merge();
instructions.getRange("A1:F1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 18 },
  verticalAlignment: "center",
};
instructions.getRange("A1:F1").format.rowHeight = 38;

const steps = [
  ["1", "Otvorite list Artikli."],
  ["2", "Ne menjajte nazive kolona u prvom redu."],
  ["3", "Jedan proizvod unosite u jedan red. Primer je već popunjen u redu 2."],
  ["4", "SKU može ostati prazan. Sistem će automatski dodeliti šifru NOV-…"],
  ["5", "Kategorija, grupa i podgrupa moraju pratiti isti redosled kao navigacija sajta; podgrupa može ostati prazna."],
  ["6", "Sačuvajte fajl kao Excel Workbook (.xlsx), pa ga uvezite kroz Artikli → Excel unos."],
  ["!", "Slike sa računara i MP cena dodaju se posle uvoza, na kartonu proizvoda i u RETAIL cenovniku."],
];
instructions.getRange("A3:B9").values = steps;
instructions.getRange("A3:A9").format = {
  fill: "#D9EAF7",
  font: { bold: true, color: "#1F4E78", size: 14 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
instructions.getRange("B3:B9").format = {
  fill: "#F7FAFC",
  font: { color: "#172B4D", size: 12 },
  wrapText: true,
  verticalAlignment: "center",
};
instructions.getRange("A3:B9").format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2F3",
};
instructions.getRange("A3:A9").format.columnWidth = 7;
instructions.getRange("B3:B9").format.columnWidth = 72;
instructions.getRange("A3:B9").format.rowHeight = 42;
instructions.getRange("A9:B9").format.fill = "#FFF2CC";
instructions.freezePanes.freezeRows(1);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 5000,
  tableMaxRows: 4,
  tableMaxCols: 8,
});
console.log(overview.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const inputPreview = await workbook.render({
  sheetName: "Artikli",
  range: "A1:AP2",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  path.join(outputDir, "template-preview-artikli.png"),
  new Uint8Array(await inputPreview.arrayBuffer()),
);
const guidePreview = await workbook.render({
  sheetName: "Uputstvo",
  range: "A1:B9",
  scale: 1.5,
  format: "png",
});
await fs.writeFile(
  path.join(outputDir, "template-preview-uputstvo.png"),
  new Uint8Array(await guidePreview.arrayBuffer()),
);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "SPC_TEST_unos_proizvoda.xlsx"));
