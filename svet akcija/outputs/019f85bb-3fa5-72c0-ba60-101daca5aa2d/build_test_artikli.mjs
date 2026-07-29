import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Artikli_Import");

const rows = [
  [
    "SKU",
    "Naziv",
    "Opis",
    "MPC",
    "Status",
    "Zalihe",
    "U dolasku",
    "Bar kod",
    "Težina kg",
    "Širina cm",
    "Dubina cm",
    "Visina cm",
    "Kom/pak",
    "Pak širina cm",
    "Pak dubina cm",
    "Pak visina cm",
    "Pak bruto kg",
    "HS kod",
    "MOQ",
  ],
  [
    "TEST-20260721-001",
    "TEST Stolna lampa Luna",
    "Test artikal za proveru XLSX importa: stolna lampa neutralne boje.",
    1990,
    "UZ",
    0,
    0,
    null,
    1.2,
    18,
    18,
    42,
    1,
    22,
    22,
    48,
    1.6,
    "940520",
    1,
  ],
  [
    "TEST-20260721-002",
    "TEST Zidna polica Nord",
    "Test artikal za proveru ažuriranja postojećeg SKU-a i dimenzija.",
    3490,
    "UZ",
    0,
    3,
    null,
    4.5,
    60,
    20,
    18,
    1,
    65,
    25,
    10,
    5.0,
    "940360",
    1,
  ],
  [
    "TEST-20260721-003",
    "TEST Kuhinjski organizator",
    "Test artikal za proveru numeričkih polja, stanja i robe u dolasku.",
    1290,
    "UZ",
    0,
    5,
    null,
    0.8,
    32,
    15,
    14,
    2,
    35,
    18,
    18,
    1.9,
    "392490",
    2,
  ],
  [
    "TEST-20260721-004",
    "TEST Dekorativni jastuk Soft",
    "Test artikal za proveru proizvoda sa manjom cenom i laganim pakovanjem.",
    990,
    "UZ",
    0,
    0,
    null,
    0.45,
    45,
    12,
    45,
    1,
    48,
    15,
    48,
    0.6,
    "940490",
    1,
  ],
  [
    "TEST-20260721-005",
    "TEST Set kutija za odlaganje",
    "Test set od tri kutije za proveru količine u pakovanju i MOQ vrednosti.",
    2490,
    "UZ",
    0,
    6,
    null,
    2.3,
    40,
    30,
    25,
    3,
    43,
    33,
    28,
    2.8,
    "630790",
    3,
  ],
];

sheet.getRange("A1:S6").values = rows;
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);

const table = sheet.tables.add("A1:S6", true, "TestArtikliImport");
table.style = "TableStyleMedium2";
table.showFilterButton = true;

sheet.getRange("A1:S1").format = {
  fill: "#2F2924",
  font: { bold: true, color: "#FFFFFF", size: 11 },
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "outside", style: "medium", color: "#2F2924" },
};
sheet.getRange("A1:S1").format.rowHeight = 32;

sheet.getRange("A2:S6").format = {
  font: { color: "#2F2924", size: 10 },
  verticalAlignment: "center",
  borders: {
    insideHorizontal: { style: "thin", color: "#E6E0DA" },
    bottom: { style: "thin", color: "#D2C9C0" },
  },
};
sheet.getRange("C2:C6").format.wrapText = true;
sheet.getRange("C2:C6").format.rowHeight = 42;
sheet.getRange("D2:D6").format.numberFormat = "#,##0";
sheet.getRange("F2:G6").format.numberFormat = "#,##0";
sheet.getRange("I2:L6").format.numberFormat = "0.00";
sheet.getRange("M2:M6").format.numberFormat = "#,##0";
sheet.getRange("N2:Q6").format.numberFormat = "0.00";
sheet.getRange("S2:S6").format.numberFormat = "#,##0";
sheet.getRange("D2:S6").format.horizontalAlignment = "right";
sheet.getRange("E2:E6").format.horizontalAlignment = "center";
sheet.getRange("E2:E100").dataValidation = {
  rule: { type: "list", values: ["SP", "IT", "DTZ", "DOB", "ARH", "UZ"] },
};

sheet.getRange("A1:A6").format.columnWidth = 22;
sheet.getRange("B1:B6").format.columnWidth = 30;
sheet.getRange("C1:C6").format.columnWidth = 52;
sheet.getRange("D1:D6").format.columnWidth = 12;
sheet.getRange("E1:E6").format.columnWidth = 10;
sheet.getRange("F1:G6").format.columnWidth = 12;
sheet.getRange("H1:H6").format.columnWidth = 16;
sheet.getRange("I1:L6").format.columnWidth = 13;
sheet.getRange("M1:M6").format.columnWidth = 11;
sheet.getRange("N1:Q6").format.columnWidth = 15;
sheet.getRange("R1:R6").format.columnWidth = 12;
sheet.getRange("S1:S6").format.columnWidth = 10;

const preview = await workbook.render({
  sheetName: "Artikli_Import",
  range: "A1:S6",
  scale: 1.4,
  format: "png",
});
await fs.writeFile(
  path.join(outputDir, "test_artikli_import_preview.png"),
  new Uint8Array(await preview.arrayBuffer()),
);

const tableCheck = await workbook.inspect({
  kind: "table",
  range: "Artikli_Import!A1:S6",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 20,
  maxChars: 8000,
});
console.log(tableCheck.ndjson);

const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
  maxChars: 2000,
});
console.log(errorCheck.ndjson);

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "mini_test_artikli_admin_import.xlsx"));
