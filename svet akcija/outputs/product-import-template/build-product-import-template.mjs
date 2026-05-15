import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("final");
const workbook = Workbook.create();

function colLabel(index) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    label = String.fromCharCode(65 + mod) + label;
    n = Math.floor((n - mod) / 26);
  }
  return label;
}

function writeSheet(sheet, title, subtitle, headers, rows, widths = {}) {
  const lastCol = colLabel(headers.length - 1);
  const headerMergeLastCol = colLabel(Math.min(headers.length - 1, 10));
  sheet.getRange(`A1:${headerMergeLastCol}1`).merge();
  sheet.getRange(`A2:${headerMergeLastCol}2`).merge();
  sheet.getRange(`A1:${lastCol}1`).format = {
    fill: "#173E43",
    font: { name: "Aptos Display", size: 16, color: "#FFFFFF", bold: true },
    verticalAlignment: "center",
  };
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A2:${lastCol}2`).format = {
    fill: "#EAF1EF",
    font: { name: "Aptos", size: 10, color: "#233033" },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A4:${lastCol}4`).values = [headers];
  sheet.getRange(`A4:${lastCol}4`).format = {
    fill: "#D6E5E0",
    font: { name: "Aptos", size: 10, color: "#173E43", bold: true },
    borders: { preset: "all", style: "thin", color: "#A9BEBA" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  if (rows.length) {
    sheet.getRange(`A5:${lastCol}${rows.length + 4}`).values = rows;
    sheet.getRange(`A5:${lastCol}${rows.length + 4}`).format = {
      fill: "#FFFFFF",
      font: { name: "Aptos", size: 10, color: "#243033" },
      borders: { preset: "all", style: "thin", color: "#D8E1DF" },
      verticalAlignment: "top",
      wrapText: true,
    };
  }
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(Math.min(2, headers.length));
  headers.forEach((_, i) => {
    const col = colLabel(i);
    sheet.getRange(`${col}:${col}`).format.columnWidthPx = widths[i] ?? 130;
  });
  sheet.getRange("1:1").format.rowHeightPx = 30;
  sheet.getRange("2:2").format.rowHeightPx = 42;
  sheet.getRange("4:4").format.rowHeightPx = 40;
}

const productHeaders = [
  "import_action",
  "sku",
  "barcode",
  "supplier",
  "supplier_external_id",
  "name",
  "slug",
  "short_description",
  "description",
  "category_paths",
  "group",
  "collection",
  "full_price_rsd",
  "sale_price_rsd",
  "discount_pct",
  "stock",
  "incoming_stock",
  "supplier_stock",
  "delivery_days_min",
  "delivery_days_max",
  "width_cm",
  "depth_cm",
  "height_cm",
  "size_label",
  "color_primary_hex",
  "color_secondary_hex",
  "is_active",
  "is_new",
  "new_until",
  "is_limited",
  "is_dtz",
  "allows_assembly",
  "feed_google",
  "feed_meta",
  "feed_tiktok",
  "pictogram_codes",
  "material_slugs",
  "assembly_cities",
  "image_1_url",
  "image_1_alt",
  "image_2_url",
  "image_2_alt",
  "image_3_url",
  "image_3_alt",
  "admin_note",
];

const productRows = [
  [
    "UPSERT",
    "LUNA-L4200",
    "'8601234567890",
    "Svet Akcija",
    "ERP-10001",
    "Bastenska garnitura Luna L4200",
    "bastenska-garnitura-luna-l4200",
    "Komplet za terasu sa stolom i 4 stolice.",
    "Moderan set za dvoriste i terasu. Aluminijumska konstrukcija, jastuci ukljuceni, jednostavno odrzavanje.",
    "Basta > Garniture; Akcije > Letnja ponuda",
    "Outdoor",
    "Luna",
    49999,
    39999,
    20,
    12,
    4,
    16,
    3,
    5,
    140,
    80,
    74,
    "140 x 80 x 74 cm",
    "#3A4A3F",
    "#E7DED0",
    "TRUE",
    "TRUE",
    "2026-06-30",
    "FALSE",
    "FALSE",
    "TRUE",
    "TRUE",
    "TRUE",
    "FALSE",
    "weatherproof;easy-clean",
    "aluminium;textile",
    "Beograd;Novi Sad",
    "https://example.com/images/luna-main.jpg",
    "Bastenska garnitura Luna, glavni prikaz",
    "https://example.com/images/luna-side.jpg",
    "Detalj stola i stolica",
    "",
    "",
    "Example row - replace URLs with real hosted images.",
  ],
  [
    "UPSERT",
    "KOMODA-OSLO-160",
    "'8601234567906",
    "Nord Home",
    "NH-4488",
    "Komoda Oslo 160",
    "komoda-oslo-160",
    "Komoda sa 3 fioke i 2 vrata.",
    "Minimalisticka komoda za dnevnu sobu sa tihim zatvaranjem i otpornom zavrsnom obradom.",
    "Dnevna soba > Komode",
    "Storage",
    "Oslo",
    32999,
    "",
    "",
    7,
    0,
    7,
    5,
    9,
    160,
    42,
    78,
    "160 x 42 x 78 cm",
    "#F4F1EA",
    "#2B2B2B",
    "TRUE",
    "FALSE",
    "",
    "FALSE",
    "FALSE",
    "FALSE",
    "TRUE",
    "TRUE",
    "TRUE",
    "soft-close",
    "mdf;metal",
    "",
    "https://example.com/images/oslo-main.jpg",
    "Komoda Oslo 160 u enterijeru",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "SKIP",
    "DRAFT-ONLY",
    "",
    "Internal",
    "",
    "Primer proizvoda koji se ne uvozi",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "FALSE",
    "FALSE",
    "",
    "FALSE",
    "FALSE",
    "FALSE",
    "FALSE",
    "FALSE",
    "FALSE",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Use SKIP for rows kept in the sheet but not imported.",
  ],
];

const products = workbook.worksheets.add("Products_Import");
writeSheet(
  products,
  "Product Import Template - Admin Panel",
  "One row per parent product SKU. Use clean text, RSD prices without thousand separators, TRUE/FALSE flags, semicolon-separated lists for categories/materials/pictograms, and hosted image URLs.",
  productHeaders,
  productRows,
  {
    0: 110,
    1: 130,
    2: 130,
    3: 140,
    4: 145,
    5: 230,
    6: 220,
    7: 260,
    8: 360,
    9: 270,
    12: 120,
    13: 120,
    14: 105,
    35: 150,
    36: 150,
    37: 150,
    38: 300,
    39: 220,
    40: 300,
    41: 220,
    42: 300,
    43: 220,
    44: 260,
  },
);

products.getRange("A5:A500").dataValidation = {
  allowBlank: false,
  list: { inCellDropDown: true, source: ["UPSERT", "SKIP", "DELETE"] },
};
for (const col of ["AA", "AB", "AD", "AE", "AF", "AG", "AH", "AI"]) {
  products.getRange(`${col}5:${col}500`).dataValidation = {
    allowBlank: true,
    list: { inCellDropDown: true, source: ["TRUE", "FALSE"] },
  };
}
products.getRange("B5:G500").format.numberFormat = "@";
products.getRange("M5:N500").format.numberFormat = '#,##0 "RSD"';
products.getRange("O5:T500").format.numberFormat = "0";
products.getRange("U5:W500").format.numberFormat = "0.00";
products.getRange("AC5:AC500").format.numberFormat = "yyyy-mm-dd";

const mediaHeaders = ["sku", "media_order", "kind", "url", "alt", "width_px", "height_px"];
const mediaRows = [
  ["LUNA-L4200", 0, "IMAGE", "https://example.com/images/luna-main.jpg", "Bastenska garnitura Luna, glavni prikaz", 1600, 1200],
  ["LUNA-L4200", 1, "IMAGE", "https://example.com/images/luna-side.jpg", "Detalj stola i stolica", 1600, 1200],
  ["KOMODA-OSLO-160", 0, "IMAGE", "https://example.com/images/oslo-main.jpg", "Komoda Oslo 160 u enterijeru", 1600, 1200],
];
const media = workbook.worksheets.add("Media");
writeSheet(
  media,
  "Media Import",
  "Optional normalized image/media tab. Use this when a product has many images or when the admin importer supports multi-sheet uploads.",
  mediaHeaders,
  mediaRows,
  { 0: 130, 1: 90, 2: 90, 3: 360, 4: 280, 5: 90, 6: 90 },
);
media.getRange("C5:C500").dataValidation = {
  allowBlank: false,
  list: { inCellDropDown: true, source: ["IMAGE", "VIDEO"] },
};

const variantHeaders = ["parent_sku", "variant_sku", "variant_name", "color_hex", "stock", "price_delta_rsd"];
const variantRows = [
  ["LUNA-L4200", "LUNA-L4200-GRAPHITE", "Grafit", "#3A4A3F", 8, 0],
  ["LUNA-L4200", "LUNA-L4200-BEIGE", "Bez", "#E7DED0", 4, 0],
];
const variants = workbook.worksheets.add("Variants");
writeSheet(
  variants,
  "Variants Import",
  "Optional normalized variant tab. Parent SKU must exist in Products_Import.",
  variantHeaders,
  variantRows,
  { 0: 140, 1: 180, 2: 180, 3: 110, 4: 80, 5: 130 },
);
variants.getRange("E5:E500").format.numberFormat = "0";
variants.getRange("F5:F500").format.numberFormat = '#,##0 "RSD"';

const guideHeaders = ["field", "required", "format", "example", "admin/import note"];
const guideRows = [
  ["sku", "YES", "Unique text", "LUNA-L4200", "Primary upsert key. Never reuse for a different product."],
  ["name", "YES", "Text", "Bastenska garnitura Luna L4200", "Visible product title."],
  ["slug", "Recommended", "lowercase-url-slug", "bastenska-garnitura-luna-l4200", "If blank, importer can generate from name, but explicit slug prevents URL churn."],
  ["description", "YES", "Plain text / safe HTML if supported", "Moderan set...", "Long PDP description."],
  ["full_price_rsd", "YES", "Number", "49999", "No currency symbol in import data."],
  ["sale_price_rsd", "Optional", "Number", "39999", "Leave blank when not on sale."],
  ["discount_pct", "Optional", "Integer", "20", "Can be calculated from full/sale price if importer supports it."],
  ["stock", "YES", "Whole number", "12", "Local sellable stock."],
  ["category_paths", "YES", "Semicolon list", "Basta > Garniture; Akcije > Letnja ponuda", "Importer should create/find categories by path."],
  ["image_1_url", "Recommended", "URL", "https://...", "Use publicly reachable image URLs."],
  ["supplier", "Recommended", "Text", "Nord Home", "Importer should create/find supplier by name."],
  ["supplier_external_id", "Recommended", "Text", "ERP-10001", "Keeps future ERP/XML updates stable."],
  ["is_active", "YES", "TRUE/FALSE", "TRUE", "Controls storefront visibility."],
  ["delivery_days_min/max", "Recommended", "Whole number", "3 / 5", "Keep min <= max."],
  ["pictogram_codes/material_slugs", "Optional", "Semicolon list", "weatherproof;easy-clean", "Importer should create/find relation rows."],
];
const guide = workbook.worksheets.add("Field_Guide");
writeSheet(
  guide,
  "Field Guide",
  "Minimum fields for the database are sku, slug, name, description, full_price_rsd, stock, delivery days, and active state. The rest makes admin import production-ready.",
  guideHeaders,
  guideRows,
  { 0: 180, 1: 100, 2: 180, 3: 260, 4: 440 },
);

const lookupHeaders = ["list_name", "allowed_values"];
const lookupRows = [
  ["import_action", "UPSERT | SKIP | DELETE"],
  ["boolean", "TRUE | FALSE"],
  ["media_kind", "IMAGE | VIDEO"],
  ["category_separator", "Use semicolon between categories, greater-than between path levels"],
  ["currency", "RSD numeric values only"],
  ["date", "YYYY-MM-DD"],
  ["image_url", "https:// publicly reachable URL"],
];
const lookups = workbook.worksheets.add("Lookups");
writeSheet(lookups, "Lookups", "Small reference tab for validation and importer mapping.", lookupHeaders, lookupRows, { 0: 170, 1: 430 });

await fs.mkdir(outputDir, { recursive: true });
const scan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(scan.ndjson);

for (const sheetName of ["Products_Import", "Media", "Variants", "Field_Guide", "Lookups"]) {
  const blob = await workbook.render({ sheetName, range: "A1:K14", scale: 1 });
  await fs.writeFile(path.join(outputDir, `${sheetName}.png`), Buffer.from(await blob.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "product_import_template_admin.xlsx"));
