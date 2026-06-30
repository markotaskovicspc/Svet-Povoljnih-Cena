import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const DEFAULT_FILE = "/Users/luka/Downloads/Book12.xlsx";
const IMPORT_SOURCE_SUPPLIER = "Excel Catalog Import";
const INVALID_CATEGORY_VALUES = new Set(["0"]);
const COMMERCIAL_REQUIRED_FIELDS = ["sku", "fullPrice", "stock"];
const COMMERCIAL_ALIASES = {
  sku: ["sku", "sifra", "šifra", "code", "artikal", "artikl"],
  fullPrice: ["cena", "mp cena", "mpc", "fullprice", "full price", "regular price"],
  salePrice: ["akcijska cena", "saleprice", "sale price", "popust cena", "snizena cena"],
  stock: ["lager", "stanje", "stock", "zaliha", "kolicina", "količina"],
  incomingStock: ["dolazeci lager", "dolazeći lager", "incomingstock", "incoming stock", "u dolasku"],
  availability: ["dostupnost", "availability", "aktivan", "active", "objavi", "publish", "online", "prodaja"],
  imageUrls: ["fotografija", "slika", "slike", "image", "imageurl", "image urls", "imageurls", "url slike"],
};
const LFS_POINTER_RE = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\b|oid sha256:/i;

const args = parseArgs(process.argv.slice(2));
const sourceFile = path.resolve(args.file ?? DEFAULT_FILE);
const commercialFile = args.commercialFile ? path.resolve(args.commercialFile) : null;
const apply = Boolean(args.apply);
const reportPath = args.report
  ? path.resolve(args.report)
  : path.resolve("svet akcija/book12-import-report.json");

const rows = readTabularRows(sourceFile);
const report = validateRows(rows);
const commercialValidation = commercialFile
  ? validateCommercialRows(readTabularRows(commercialFile), report.accepted)
  : missingCommercialValidation(report.accepted, "Commercial file was not provided.");
attachCommercialReport(report, commercialFile, commercialValidation);

console.log(
  [
    `Book12 import ${apply ? "apply" : "dry-run"}`,
    `file=${sourceFile}`,
    `commercialFile=${commercialFile ?? "(not provided)"}`,
    `recordsRead=${report.recordsRead}`,
    `recordsOk=${report.accepted.length}`,
    `recordsSkipped=${report.skipped.length}`,
    `duplicateSkus=${report.duplicateSkus.length}`,
    `duplicateBarcodes=${report.duplicateBarcodes.length}`,
    `commercialMatched=${report.commercialMatched}`,
    `publishable=${report.publishable.length}`,
    `unpublishable=${report.unpublishable.length}`,
  ].join("\n"),
);

if (report.duplicateSkus.length || report.duplicateBarcodes.length) {
  await saveReport(reportPath, report);
  fail(`Validation failed. Report written to ${reportPath}`);
}

if (apply) {
  if (!commercialFile) {
    await saveReport(reportPath, report);
    fail(`--commercial-file is required with --apply. Report written to ${reportPath}`);
  }
  if (!commercialValidation.canApply) {
    await saveReport(reportPath, report);
    fail(`Commercial validation failed. Report written to ${reportPath}`);
  }
  const prisma = createPrismaClient();
  try {
    await ensureDatabaseSchema(prisma);
    const result = await importRows(prisma, report, commercialValidation.bySku);
    report.importResult = result;
    console.log(
      `Imported ${result.created} created, ${result.updated} updated, ${result.skipped} skipped. ImportRun ${result.importRunId}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await saveReport(reportPath, report);
console.log(`Validation report written to ${reportPath}`);

async function ensureDatabaseSchema(prisma) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeLabel" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "colorPrimary" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "colorSecondary" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProductMedia" ADD COLUMN IF NOT EXISTS "thumbUrl" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProductMedia" ADD COLUMN IF NOT EXISTS "cardUrl" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProductMedia" ADD COLUMN IF NOT EXISTS "pdpUrl" TEXT`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Product_barcode_key" ON "Product"("barcode")`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--file") {
      parsed.file = argv[++i];
    } else if (arg.startsWith("--file=")) {
      parsed.file = arg.slice("--file=".length);
    } else if (arg === "--commercial-file") {
      parsed.commercialFile = argv[++i];
    } else if (arg.startsWith("--commercial-file=")) {
      parsed.commercialFile = arg.slice("--commercial-file=".length);
    } else if (arg === "--report") {
      parsed.report = argv[++i];
    } else if (arg.startsWith("--report=")) {
      parsed.report = arg.slice("--report=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run import:book12 -- [--file /path/Book12.xlsx] [--commercial-file /path/commercial.xlsx] [--report report.json] [--apply]`);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readTabularRows(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv") return readCsvRows(file);
  return readWorkbookRows(file);
}

function readWorkbookRows(file) {
  const python = process.env.PYTHON ?? "python3";
  const script = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as ET

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
path = sys.argv[1]

def col_index(cell_ref):
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    idx = 0
    for ch in letters:
        idx = idx * 26 + ord(ch.upper()) - 64
    return idx - 1

def text_content(node):
    if node is None:
        return ""
    return "".join(node.itertext())

with zipfile.ZipFile(path) as z:
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("a:si", NS):
            shared.append(text_content(si))

    workbook = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_by_id = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels
    }
    first_sheet = workbook.find("a:sheets/a:sheet", NS)
    rel_id = first_sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
    target = rel_by_id[rel_id]
    sheet_path = "xl/" + target.lstrip("/")
    sheet = ET.fromstring(z.read(sheet_path))

    out = []
    for row in sheet.findall(".//a:sheetData/a:row", NS):
        values = {}
        max_col = -1
        for cell in row.findall("a:c", NS):
            ref = cell.attrib.get("r", "")
            idx = col_index(ref)
            max_col = max(max_col, idx)
            kind = cell.attrib.get("t")
            if kind == "s":
                raw = cell.findtext("a:v", default="", namespaces=NS)
                value = shared[int(raw)] if raw else ""
            elif kind == "inlineStr":
                value = text_content(cell.find("a:is", NS))
            elif kind == "e":
                value = ""
            else:
                value = cell.findtext("a:v", default="", namespaces=NS)
            values[idx] = value
        if max_col >= 0:
            out.append([values.get(i, "") for i in range(max_col + 1)])

print(json.dumps(out, ensure_ascii=False))
`;
  const result = spawnSync(python, ["-c", script, file], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.error) fail(`Could not start ${python}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`Could not read workbook:\n${result.stderr || result.stdout}`);
  }
  const matrix = JSON.parse(result.stdout);
  if (!Array.isArray(matrix) || matrix.length < 2) {
    fail("Workbook does not contain a header row and data rows.");
  }

  const headers = matrix[0].map((h) => cleanText(h));
  return matrix.slice(1).map((row, index) => {
    const item = { rowNumber: index + 2 };
    headers.forEach((header, i) => {
      item[header] = row[i] ?? "";
    });
    return item;
  });
}

function readCsvRows(file) {
  const text = readUtf8Sync(file);
  const matrix = parseCsv(text);
  if (!Array.isArray(matrix) || matrix.length < 2) {
    fail("CSV file does not contain a header row and data rows.");
  }
  const headers = matrix[0].map((h) => cleanText(h));
  return matrix.slice(1).map((row, index) => {
    const item = { rowNumber: index + 2 };
    headers.forEach((header, i) => {
      item[header] = row[i] ?? "";
    });
    return item;
  });
}

function readUtf8Sync(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    fail(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cleanText(cell)));
}

function validateRows(rows) {
  const accepted = [];
  const skipped = [];
  const skuCounts = new Map();
  const barcodeCounts = new Map();

  for (const row of rows) {
    const normalized = normalizeRow(row);
    if (normalized.sku) {
      skuCounts.set(normalized.sku, (skuCounts.get(normalized.sku) ?? 0) + 1);
    }
    if (normalized.barcode) {
      barcodeCounts.set(normalized.barcode, (barcodeCounts.get(normalized.barcode) ?? 0) + 1);
    }

    const issues = [];
    if (!normalized.sku) issues.push("Missing SKU");
    if (!normalized.categoryName) issues.push("Missing category");
    if (normalized.categoryName && INVALID_CATEGORY_VALUES.has(normalized.categoryName)) {
      issues.push(`Invalid category: ${normalized.categoryName}`);
    }
    if (!normalized.supplierName) issues.push("Missing supplier");
    if (!normalized.description) issues.push("Missing description");
    if (normalized.description && LFS_POINTER_RE.test(normalized.description)) {
      issues.push("Broken Git LFS pointer description");
    }
    if (!normalized.shortName) issues.push("Missing short name");

    if (issues.length) {
      skipped.push({ rowNumber: row.rowNumber, sku: normalized.sku || null, issues, raw: row });
    } else {
      accepted.push(normalized);
    }
  }

  const duplicateSkus = duplicatesFrom(skuCounts);
  const duplicateBarcodes = duplicatesFrom(barcodeCounts);

  return {
    sourceFile,
    dryRun: !apply,
    recordsRead: rows.length,
    recordsOk: accepted.length,
    recordsSkipped: skipped.length,
    accepted,
    skipped,
    duplicateSkus,
    duplicateBarcodes,
    categories: countBy(accepted, "categoryName"),
    suppliers: countBy(accepted, "supplierName"),
    collections: countBy(accepted.filter((r) => r.collectionName), "collectionName"),
    ownerDataWarnings: summarizeOwnerDataWarnings(accepted),
  };
}

function validateCommercialRows(rows, acceptedRows) {
  const columns = resolveCommercialColumns(rows[0] ?? {});
  const schemaErrors = COMMERCIAL_REQUIRED_FIELDS
    .filter((field) => !columns[field])
    .map((field) => `Missing required commercial column for ${field}. Accepted aliases: ${COMMERCIAL_ALIASES[field].join(", ")}`);

  const parsedRows = [];
  const skuCounts = new Map();
  for (const row of rows) {
    const sku = normalizeSku(readColumn(row, columns.sku));
    if (!sku && rowIsEmpty(row)) continue;
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
    parsedRows.push(parseCommercialRow(row, columns));
  }

  const duplicateSkus = duplicatesFrom(skuCounts);
  const duplicateSet = new Set(duplicateSkus.map((d) => d.value));
  const bySku = new Map();
  for (const row of parsedRows) {
    if (row.sku && !duplicateSet.has(row.sku)) bySku.set(row.sku, row);
  }

  const catalogSkus = new Set(acceptedRows.map((row) => row.sku));
  const extraSkus = [...skuCounts.keys()].filter((sku) => !catalogSkus.has(sku)).sort();
  const publishable = [];
  const unpublishable = [];
  const missing = [];

  for (const row of acceptedRows) {
    const duplicate = duplicateSet.has(row.sku);
    const commercial = bySku.get(row.sku);
    const issues = [];
    const warnings = [...(row.ownerDataWarnings ?? [])];
    if (duplicate) issues.push("Duplicate commercial SKU");
    if (!commercial) issues.push("Missing commercial row");
    if (commercial?.issues.length) issues.push(...commercial.issues);
    if (commercial?.warnings.length) warnings.push(...commercial.warnings);

    if (issues.length) {
      if (!commercial && !duplicate) missing.push(row.sku);
      unpublishable.push({
        sku: row.sku,
        rowNumber: row.rowNumber,
        commercialRowNumber: commercial?.rowNumber ?? null,
        issues,
        warnings,
        blocking: true,
      });
    } else if (warnings.length) {
      unpublishable.push({
        sku: row.sku,
        rowNumber: row.rowNumber,
        commercialRowNumber: commercial?.rowNumber ?? null,
        issues: [],
        warnings,
        blocking: false,
      });
    } else {
      publishable.push({
        sku: row.sku,
        rowNumber: row.rowNumber,
        commercialRowNumber: commercial.rowNumber,
        fullPrice: commercial.fullPrice,
        salePrice: commercial.salePrice,
        stock: commercial.stock,
        incomingStock: commercial.incomingStock,
        availableForSale: commercial.availableForSale,
        imageCount: commercial.imageUrls.length,
      });
    }
  }
  const blockingUnpublishable = unpublishable.filter((row) => row.blocking);

  return {
    columns: {
      sku: columns.sku ?? null,
      fullPrice: columns.fullPrice ?? null,
      salePrice: columns.salePrice ?? null,
      stock: columns.stock ?? null,
      incomingStock: columns.incomingStock ?? null,
      availability: columns.availability ?? null,
      imageUrls: columns.imageUrls,
    },
    matched: acceptedRows.length - missing.length,
    missing,
    publishable,
    unpublishable,
    blockingUnpublishable,
    errors: schemaErrors,
    duplicateSkus,
    extraSkus,
    bySku,
    canApply:
      schemaErrors.length === 0 &&
      duplicateSkus.length === 0 &&
      missing.length === 0 &&
      blockingUnpublishable.length === 0 &&
      acceptedRows.length > 0,
  };
}

function missingCommercialValidation(acceptedRows, reason) {
  return {
    columns: {
      sku: null,
      fullPrice: null,
      salePrice: null,
      stock: null,
      incomingStock: null,
      availability: null,
      imageUrls: [],
    },
    matched: 0,
    missing: acceptedRows.map((row) => row.sku),
    publishable: [],
    unpublishable: acceptedRows.map((row) => ({
      sku: row.sku,
      rowNumber: row.rowNumber,
      commercialRowNumber: null,
      issues: [reason],
      warnings: row.ownerDataWarnings ?? [],
      blocking: true,
    })),
    blockingUnpublishable: acceptedRows.map((row) => ({
      sku: row.sku,
      rowNumber: row.rowNumber,
      commercialRowNumber: null,
      issues: [reason],
      warnings: row.ownerDataWarnings ?? [],
      blocking: true,
    })),
    errors: [reason],
    duplicateSkus: [],
    extraSkus: [],
    bySku: new Map(),
    canApply: false,
  };
}

function attachCommercialReport(report, file, validation) {
  report.commercialFile = file;
  report.commercialColumns = validation.columns;
  report.commercialMatched = validation.matched;
  report.commercialMissing = validation.missing;
  report.publishable = validation.publishable;
  report.unpublishable = validation.unpublishable;
  report.commercialBlockingUnpublishable = validation.blockingUnpublishable;
  report.commercialErrors = validation.errors;
  report.commercialDuplicateSkus = validation.duplicateSkus;
  report.commercialExtraSkus = validation.extraSkus;
}

function resolveCommercialColumns(row) {
  const headers = Object.keys(row).filter((key) => key !== "rowNumber");
  const normalized = headers.map((header) => ({
    header,
    normalized: normalizeHeader(header),
  }));
  const columns = {};
  for (const field of Object.keys(COMMERCIAL_ALIASES)) {
    if (field === "imageUrls") continue;
    columns[field] = normalized.find(({ normalized: h }) =>
      COMMERCIAL_ALIASES[field].map(normalizeHeader).includes(h),
    )?.header;
  }
  columns.imageUrls = normalized
    .filter(({ normalized: h }) => {
      const aliases = COMMERCIAL_ALIASES.imageUrls.map(normalizeHeader);
      return aliases.includes(h) || h.includes("slika") || h.includes("image") || h.includes("fotografija");
    })
    .map(({ header }) => header);
  return columns;
}

function parseCommercialRow(row, columns) {
  const issues = [];
  const warnings = [];
  const sku = normalizeSku(readColumn(row, columns.sku));
  if (!sku) issues.push("Missing SKU");

  const fullPrice = parseRequiredMoney(readColumn(row, columns.fullPrice), "full price", issues);
  const salePrice = parseOptionalMoney(readColumn(row, columns.salePrice), "sale price", issues);
  const stock = parseRequiredInteger(readColumn(row, columns.stock), "stock", issues);
  const incomingStock = parseOptionalInteger(readColumn(row, columns.incomingStock), "incoming stock", issues) ?? 0;
  const availableForSale = parseOptionalAvailability(readColumn(row, columns.availability), "availability", issues);
  const imageUrls = parseImageUrls(columns.imageUrls.flatMap((column) => readColumn(row, column)));

  if (fullPrice != null && fullPrice <= 1) issues.push("Full price must be greater than 1 RSD");
  if (salePrice != null && salePrice <= 0) issues.push("Sale price must be greater than 0 RSD");
  if (salePrice != null && fullPrice != null && salePrice >= fullPrice) {
    issues.push("Sale price must be lower than full price");
  }
  if (stock != null && stock < 0) issues.push("Stock must not be negative");
  if (stock === 0) warnings.push("Stock is zero; product will import as inactive");
  if (incomingStock < 0) issues.push("Incoming stock must not be negative");
  if (availableForSale === false) warnings.push("Owner marked product unavailable for sale");
  if (imageUrls.length === 0) {
    issues.push("Missing required product media URL");
  }

  return {
    rowNumber: row.rowNumber,
    sku,
    fullPrice,
    salePrice,
    stock,
    incomingStock,
    availableForSale,
    imageUrls,
    issues,
    warnings,
  };
}

function normalizeRow(row) {
  const sku = normalizeSku(row.SKU ?? row["Šifra"] ?? row.Sifra);
  const description = cleanText(row.Opis);
  const shortName = cleanText(row["Kratki naziv"]);
  const categoryName = cleanText(row.Grupa).replace(/\.0$/, "");
  const rawSupplier = cleanText(row["Dobavljač"]);
  return {
    rowNumber: row.rowNumber,
    sku,
    barcode: normalizeBarcode(row["Bar kod"]),
    categoryName,
    supplierName: normalizeSupplier(rawSupplier),
    rawSupplierName: rawSupplier || null,
    collectionName: cleanText(row["Kolekcija (brend)"]) || null,
    description,
    shortName,
    name: buildProductName(description, shortName),
    sizeLabel: cleanText(row["Veličina"]) || null,
    colorPrimary: cleanText(row["Boja 1"]) || null,
    colorSecondary: cleanText(row["Boja 2"]) || null,
    slug: slugify(`${shortName}-${sku}`),
    ownerDataWarnings: ownerDataWarnings({
      barcode: normalizeBarcode(row["Bar kod"]),
      collectionName: cleanText(row["Kolekcija (brend)"]) || null,
      colorPrimary: cleanText(row["Boja 1"]) || null,
      colorSecondary: cleanText(row["Boja 2"]) || null,
    }),
  };
}

function normalizeBarcode(value) {
  const text = cleanText(value).replace(/\.0$/, "");
  return text || null;
}

function ownerDataWarnings(row) {
  const warnings = [];
  if (!row.barcode) warnings.push("Missing barcode");
  if (!row.collectionName) warnings.push("Missing brand/collection");
  if (!row.colorPrimary) warnings.push("Missing primary color");
  if (!row.colorSecondary) warnings.push("Missing secondary color");
  return warnings;
}

function summarizeOwnerDataWarnings(rows) {
  const byIssue = {};
  let rowsWithWarnings = 0;
  for (const row of rows) {
    if (!row.ownerDataWarnings?.length) continue;
    rowsWithWarnings++;
    for (const issue of row.ownerDataWarnings) {
      byIssue[issue] = (byIssue[issue] ?? 0) + 1;
    }
  }
  return { rowsWithWarnings, byIssue };
}

function normalizeSupplier(value) {
  const compact = cleanText(value).replace(/\s+/g, " ");
  if (/^kerry\s*casa\s*co\.?\s*,?\s*ltd\.?$/i.test(compact)) {
    return "Kerry Casa Co., Ltd.";
  }
  return compact;
}

function buildProductName(description, shortName) {
  if (!description) return shortName;
  if (!shortName) return description;
  if (description.toLocaleLowerCase("sr-Latn-RS").includes(shortName.toLocaleLowerCase("sr-Latn-RS"))) {
    return description;
  }
  return `${description} ${shortName}`;
}

async function importRows(prisma, report, commercialBySku) {
  const importSupplier = await prisma.supplier.upsert({
    where: { name: IMPORT_SOURCE_SUPPLIER },
    create: {
      name: IMPORT_SOURCE_SUPPLIER,
      enabled: false,
      notes: `Manual Excel import source: ${sourceFile}; commercial source: ${commercialFile}`,
    },
    update: {
      enabled: false,
      notes: `Manual Excel import source: ${sourceFile}; commercial source: ${commercialFile}`,
    },
  });

  const run = await prisma.importRun.create({
    data: {
      supplierId: importSupplier.id,
      status: "RUNNING",
      recordsRead: report.recordsRead,
    },
  });

  let created = 0;
  let updated = 0;
  let importedUnavailable = 0;
  const errors = [];

  for (const row of report.accepted) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const commercial = commercialBySku.get(row.sku);
        if (!commercial || commercial.issues.length) {
          throw new Error(`Commercial data for SKU ${row.sku} is not publishable.`);
        }
        const shouldPublish = commercial.stock > 0 && commercial.availableForSale !== false;
        const [categoryId, supplierId, collectionId] = await Promise.all([
          ensureCategory(tx, row.categoryName),
          ensureSupplier(tx, row.supplierName),
          row.collectionName ? ensureCollection(tx, row.collectionName) : Promise.resolve(null),
        ]);

        const existing = await tx.product.findUnique({
          where: { sku: row.sku },
          select: { id: true },
        });

        const data = {
          sku: row.sku,
          barcode: row.barcode,
          slug: row.slug,
          name: row.name,
          description: row.description,
          shortDescription: row.shortName,
          sizeLabel: row.sizeLabel,
          colorPrimary: row.colorPrimary,
          colorSecondary: row.colorSecondary,
          collectionId,
          fullPrice: new Prisma.Decimal(commercial.fullPrice),
          salePrice: commercial.salePrice != null ? new Prisma.Decimal(commercial.salePrice) : null,
          discountPct: discountPct(commercial.fullPrice, commercial.salePrice),
          stock: commercial.stock,
          incomingStock: commercial.incomingStock,
          supplierStock: commercial.stock,
          supplierId,
          supplierExternalId: row.sku,
          availableWebManual: commercial.availableForSale ?? true,
          isActive: shouldPublish,
        };

        let productId;
        let result;
        if (existing) {
          await tx.product.update({ where: { id: existing.id }, data });
          productId = existing.id;
          result = "updated";
        } else {
          const product = await tx.product.create({
            data,
            select: { id: true },
          });
          productId = product.id;
          result = "created";
        }

        await tx.productCategory.deleteMany({ where: { productId } });
        await tx.productCategory.create({ data: { productId, categoryId } });

        if (commercial.imageUrls.length) {
          await tx.productMedia.deleteMany({ where: { productId } });
          await tx.productMedia.createMany({
            data: commercial.imageUrls.map((url, order) => ({
              productId,
              kind: "IMAGE",
              url,
              alt: row.name,
              order,
            })),
          });
        }
        return { result, shouldPublish };
      });
      if (outcome.result === "created") created++;
      else updated++;
      if (!outcome.shouldPublish) importedUnavailable++;
    } catch (err) {
      errors.push({
        rowNumber: row.rowNumber,
        sku: row.sku,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const recordsOk = created + updated;
  const recordsFail = report.recordsSkipped + errors.length;
  const status = errors.length ? "PARTIAL" : report.recordsSkipped ? "PARTIAL" : "SUCCESS";
  const errorMessage = [
    report.recordsSkipped ? `${report.recordsSkipped} skipped by validation` : "",
    errors.length ? `${errors.length} database errors` : "",
  ].filter(Boolean).join("; ") || null;

  await prisma.importRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      recordsRead: report.recordsRead,
      recordsOk,
      recordsFail,
      errorMessage,
    },
  });

  return {
    importRunId: run.id,
    status,
    created,
    updated,
    skipped: report.recordsSkipped,
    importedUnavailable,
    databaseErrors: errors,
  };
}

async function ensureCategory(tx, name) {
  const slug = slugify(name);
  const pathValue = `/${slug}`;
  const existing = await tx.category.findUnique({
    where: { path: pathValue },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.category.create({
    data: {
      slug,
      name,
      path: pathValue,
      level: 0,
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureSupplier(tx, name) {
  const row = await tx.supplier.upsert({
    where: { name },
    create: { name, enabled: true },
    update: {},
    select: { id: true },
  });
  return row.id;
}

async function ensureCollection(tx, name) {
  const slug = slugify(name);
  const row = await tx.collection.upsert({
    where: { slug },
    create: { slug, name },
    update: { name },
    select: { id: true },
  });
  return row.id;
}

function createPrismaClient() {
  const rawConnectionString = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
  if (!rawConnectionString) {
    fail("Database connection string is required to run with --apply.");
  }
  return new PrismaClient({
    adapter: new PrismaPg(withSslNoVerify(rawConnectionString)),
    log: ["error"],
  });
}

function withSslNoVerify(connectionString) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=no-verify`;
  }
}

function readColumn(row, column) {
  if (!column) return "";
  return cleanText(row[column]);
}

function rowIsEmpty(row) {
  return Object.entries(row).every(([key, value]) => key === "rowNumber" || !cleanText(value));
}

function normalizeSku(value) {
  return cleanText(value).replace(/\.0$/, "");
}

function normalizeHeader(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseRequiredMoney(value, label, issues) {
  const parsed = parseMoney(value);
  if (parsed == null) issues.push(`Missing ${label}`);
  else if (!Number.isFinite(parsed)) issues.push(`Invalid ${label}`);
  return parsed;
}

function parseOptionalMoney(value, label, issues) {
  if (!cleanText(value)) return null;
  const parsed = parseMoney(value);
  if (parsed == null || !Number.isFinite(parsed)) {
    issues.push(`Invalid ${label}`);
    return null;
  }
  return parsed;
}

function parseMoney(value) {
  let text = cleanText(value);
  if (!text) return null;
  text = text.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    text = text.replaceAll(thousands, "").replace(decimal, ".");
  } else if (lastComma > -1) {
    text = text.replace(",", ".");
  } else if ((text.match(/\./g) ?? []).length > 1) {
    const last = text.lastIndexOf(".");
    text = text.slice(0, last).replaceAll(".", "") + text.slice(last);
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredInteger(value, label, issues) {
  const parsed = parseInteger(value);
  if (parsed == null) issues.push(`Missing ${label}`);
  else if (!Number.isInteger(parsed)) issues.push(`Invalid ${label}`);
  return parsed;
}

function parseOptionalInteger(value, label, issues) {
  if (!cleanText(value)) return null;
  const parsed = parseInteger(value);
  if (parsed == null || !Number.isInteger(parsed)) {
    issues.push(`Invalid ${label}`);
    return null;
  }
  return parsed;
}

function parseInteger(value) {
  const parsed = parseMoney(value);
  if (parsed == null) return null;
  return Number.isInteger(parsed) ? parsed : null;
}

function parseOptionalAvailability(value, label, issues) {
  const text = normalizeHeader(value);
  if (!text) return null;
  if (["da", "yes", "y", "true", "1", "active", "aktivan", "objavi", "online", "dostupno"].includes(text)) {
    return true;
  }
  if (["ne", "no", "n", "false", "0", "inactive", "neaktivan", "ne objavi", "offline", "nedostupno"].includes(text)) {
    return false;
  }
  issues.push(`Invalid ${label}`);
  return null;
}

function parseImageUrls(values) {
  return values
    .flatMap((value) => cleanText(value).split(/[\n;,|]+/g))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function discountPct(fullPrice, salePrice) {
  if (salePrice == null || salePrice >= fullPrice) return null;
  return Math.max(0, Math.round(((fullPrice - salePrice) / fullPrice) * 100));
}

function cleanText(value) {
  if (value == null) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function duplicatesFrom(counts) {
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key];
    if (value) acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function slugify(input) {
  return cleanText(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

async function saveReport(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
