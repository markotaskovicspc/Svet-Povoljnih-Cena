import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ArticleStatus, Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import {
  assertArticleSkuAvailable,
  composedArticleName,
  nextArticleSku,
  resolveArticleCategory,
  resolveNamedArticleRelation,
  syncArticleLookupAssignments,
} from "@/lib/admin/article-master.server";
import { articleSlug, optionalDateInput } from "@/lib/article-master";
import {
  hasMeaningfulProductDescription,
  resolveImportedFullDescription,
  resolveImportedShortDescription,
} from "@/lib/product-descriptions";
import { setDefaultWarehouseStock } from "@/lib/inventory";
import {
  productNewUntilIsActive,
  resolveAdminImportedProductNewness,
} from "@/lib/product-newness";
import { ensureCategoryGroup } from "@/lib/category-groups.server";
import { lockSupplierOwnedFields } from "@/lib/rabalux/ownership.server";
import {
  defaultProductFamilyLabel,
  normalizeProductFamilyCode,
  normalizeProductFamilyHex,
  normalizeProductFamilyLabel,
  productFamilyLabelKey,
} from "@/lib/product-family";
import {
  propagateProductFamilySharedData,
  setProductFamilyMembership,
} from "@/lib/product-family.server";
import { validateNewArticleImportRequiredFields } from "@/lib/admin/article-import-required";
import { upsertActiveRetailPrice } from "@/lib/pricing/retail-price-write.server";
import { recomputeOpenPurchaseOrderLogisticsForProducts } from "@/lib/admin/po";
import { hasProductVolumeSource } from "@/lib/admin/purchase-order";
import {
  findArticleImportWorksheet,
  normalizeArticleImportHeader,
  type ArticleImportColumn,
} from "@/lib/admin/article-import-workbook";

type ImportError = { row: number; field: string; message: string };

type ArticleImportRow = {
  row: number;
  sku: string | null;
  status: ArticleStatus | null;
  photoUrl: string | null;
  supplier: string | null;
  category: string | null;
  subgroup: string | null;
  group: string | null;
  collection: string | null;
  shortDescription: string | null;
  shortName: string;
  attribute1: string | null;
  attribute2: string | null;
  attribute3: string | null;
  attribute4: string | null;
  color1: string | null;
  color2: string | null;
  benefits: string | null;
  description: string | null;
  stock: number | null;
  weightKg: number | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  grossWeightKg: number | null;
  unitPackWidthCm: number | null;
  unitPackDepthCm: number | null;
  unitPackHeightCm: number | null;
  packQty: number | null;
  palletQty: number | null;
  packWidthCm: number | null;
  packDepthCm: number | null;
  packHeightCm: number | null;
  packGrossWeightKg: number | null;
  containerQty: number | null;
  containerGrossWeightKg: number | null;
  supplierProductName: string | null;
  materialText: string | null;
  certificates: string | null;
  barcode: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  retailPrice: number | null;
  customsRate: number | null;
  ananasBrokeragePct: number | null;
  ananasStoragePct: number | null;
  ananasDeliveryPct: number | null;
  webCheck: boolean | null;
  wholesaleCheck: boolean | null;
  exportCheck: boolean | null;
  moq: number | null;
  newUntil: Date | null;
  familyCode: string | null;
  familyColorLabel: string | null;
  familyColorHex: string | null;
  familyPosition: number | null;
  familyPrimary: boolean | null;
  familyStorefrontEnabled: boolean | null;
};

function cellText(cell: ExcelJS.Cell) {
  return cell.text.trim();
}

function imageUrlCell(
  row: ExcelJS.Row,
  column: number | undefined,
  errors: ImportError[],
) {
  if (!column) return null;
  const raw = cellText(row.getCell(column));
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    errors.push({
      row: row.number,
      field: "photoUrl",
      message: "Fotografija mora biti puna http/https adresa.",
    });
    return null;
  }
}

function numberCell(
  row: ExcelJS.Row,
  column: number | undefined,
  field: string,
  errors: ImportError[],
  options: { integer?: boolean; min?: number } = {},
) {
  if (!column) return null;
  const raw = cellText(row.getCell(column)).replace(/\s/g, "").replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed) ||
    (options.integer && !Number.isInteger(parsed)) ||
    (options.min !== undefined && parsed < options.min)
  ) {
    errors.push({ row: row.number, field, message: "Broj nije u dozvoljenom formatu." });
    return null;
  }
  return parsed;
}

function booleanCell(
  row: ExcelJS.Row,
  column: number | undefined,
  field: string,
  errors: ImportError[],
) {
  if (!column) return null;
  const raw = normalizeArticleImportHeader(cellText(row.getCell(column)));
  if (!raw) return null;
  if (["da", "true", "1", "x", "yes"].includes(raw)) return true;
  if (["ne", "false", "0", "no"].includes(raw)) return false;
  errors.push({ row: row.number, field, message: "Dozvoljeno je Da/Ne, true/false ili 1/0." });
  return null;
}

function dateCell(
  row: ExcelJS.Row,
  column: number | undefined,
  field: string,
  errors: ImportError[],
) {
  if (!column) return null;
  const cell = row.getCell(column);
  if (!cellText(cell)) return null;
  const raw = cell.value;
  let date: Date | null = null;
  try {
    date = raw instanceof Date ? raw : optionalDateInput(cellText(cell));
  } catch {
    errors.push({ row: row.number, field, message: "Datum nije u dozvoljenom formatu." });
    return null;
  }
  if (!date || Number.isNaN(date.getTime())) {
    errors.push({ row: row.number, field, message: "Datum nije u dozvoljenom formatu." });
    return null;
  }
  return date;
}

function statusFlags(status: ArticleStatus) {
  if (status === "DTZ") return { isActive: true, isDtz: true, isLimited: false };
  if (status === "IT") return { isActive: true, isDtz: false, isLimited: true };
  if (status === "ARH" || status === "UZ") {
    return { isActive: false, isDtz: false, isLimited: false };
  }
  return { isActive: true, isDtz: false, isLimited: false };
}

export async function POST(request: Request) {
  const admin = await requireAdminAction(["CONTENT"]);
  const form = await request.formData();
  const mode = form.get("mode") === "apply" ? "apply" : "preview";
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      { ok: false, error: "Izaberite .xlsx datoteku." },
      { status: 400 },
    );
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, error: "Datoteka može imati najviše 8 MB." },
      { status: 413 },
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load((await file.arrayBuffer()) as never);
  } catch {
    return NextResponse.json(
      { ok: false, error: "XLSX datoteka nije čitljiva." },
      { status: 400 },
    );
  }
  const selection = findArticleImportWorksheet(workbook);
  if (!selection) {
    return NextResponse.json({ ok: false, error: "XLSX nema radni list." }, { status: 400 });
  }

  const { worksheet, headerRow, headers, recognizedColumns } = selection;
  const source = {
    worksheet: worksheet.name,
    headerRow,
    columns: recognizedColumns,
  };
  const warnings = selection.hasLegacyTncColumns
    ? [
        "Kolone T&C od/do su ignorisane. Za ponudu bez vremenskog ograničenja koristite DTZ u koloni Status.",
      ]
    : [];
  const errors: ImportError[] = [];
  if (!headers.has("shortName")) {
    errors.push({ row: headerRow, field: "shortName", message: "Nedostaje kolona Kratki naziv." });
  }

  const rows: ArticleImportRow[] = [];
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellText(cell)) hasValue = true;
    });
    if (!hasValue) return;
    const textAt = (field: ArticleImportColumn) => {
      const column = headers.get(field);
      return column ? cellText(row.getCell(column)) : "";
    };
    const sku = textAt("sku") || null;
    const shortName = textAt("shortName");
    const barcode = textAt("barcode") || null;
    const rawStatus = textAt("status").toUpperCase();
    const status = rawStatus && Object.values(ArticleStatus).includes(rawStatus as ArticleStatus)
      ? (rawStatus as ArticleStatus)
      : null;
    if (!shortName) {
      errors.push({ row: rowNumber, field: "shortName", message: "Kratki naziv je obavezan." });
    }
    if (rawStatus && !status) {
      errors.push({
        row: rowNumber,
        field: "status",
        message: "Status mora biti SP, IT, DTZ, DOB, ARH ili UZ.",
      });
    }
    if (sku && seenSkus.has(sku)) {
      errors.push({ row: rowNumber, field: "sku", message: "SKU je dupliran u datoteci." });
    }
    if (barcode && seenBarcodes.has(barcode)) {
      errors.push({ row: rowNumber, field: "barcode", message: "Bar kod je dupliran u datoteci." });
    }
    if (sku) seenSkus.add(sku);
    if (barcode) seenBarcodes.add(barcode);

    const parsedRow: ArticleImportRow = {
      row: rowNumber,
      sku,
      status,
      photoUrl: imageUrlCell(row, headers.get("photoUrl"), errors),
      supplier: textAt("supplier") || null,
      category: textAt("category") || null,
      subgroup: textAt("subgroup") || null,
      group: textAt("group") || null,
      collection: textAt("collection") || null,
      shortDescription: textAt("shortDescription") || null,
      shortName,
      attribute1: textAt("attribute1") || null,
      attribute2: textAt("attribute2") || null,
      attribute3: textAt("attribute3") || null,
      attribute4: textAt("attribute4") || null,
      color1: textAt("color1") || null,
      color2: textAt("color2") || null,
      benefits: textAt("benefits") || null,
      description: textAt("description") || null,
      stock: numberCell(row, headers.get("stock"), "stock", errors, { integer: true, min: 0 }),
      weightKg: numberCell(row, headers.get("weightKg"), "weightKg", errors, { min: 0 }),
      widthCm: numberCell(row, headers.get("widthCm"), "widthCm", errors, { min: 0 }),
      depthCm: numberCell(row, headers.get("depthCm"), "depthCm", errors, { min: 0 }),
      heightCm: numberCell(row, headers.get("heightCm"), "heightCm", errors, { min: 0 }),
      grossWeightKg: numberCell(row, headers.get("grossWeightKg"), "grossWeightKg", errors, { min: 0 }),
      unitPackWidthCm: numberCell(row, headers.get("unitPackWidthCm"), "unitPackWidthCm", errors, { min: 0 }),
      unitPackDepthCm: numberCell(row, headers.get("unitPackDepthCm"), "unitPackDepthCm", errors, { min: 0 }),
      unitPackHeightCm: numberCell(row, headers.get("unitPackHeightCm"), "unitPackHeightCm", errors, { min: 0 }),
      packQty: numberCell(row, headers.get("packQty"), "packQty", errors, { integer: true, min: 0 }),
      palletQty: numberCell(row, headers.get("palletQty"), "palletQty", errors, { integer: true, min: 1 }),
      packWidthCm: numberCell(row, headers.get("packWidthCm"), "packWidthCm", errors, { min: 0 }),
      packDepthCm: numberCell(row, headers.get("packDepthCm"), "packDepthCm", errors, { min: 0 }),
      packHeightCm: numberCell(row, headers.get("packHeightCm"), "packHeightCm", errors, { min: 0 }),
      packGrossWeightKg: numberCell(row, headers.get("packGrossWeightKg"), "packGrossWeightKg", errors, { min: 0 }),
      containerQty: numberCell(row, headers.get("containerQty"), "containerQty", errors, { integer: true, min: 1 }),
      containerGrossWeightKg: numberCell(row, headers.get("containerGrossWeightKg"), "containerGrossWeightKg", errors, { min: 0.001 }),
      supplierProductName: textAt("supplierProductName") || null,
      materialText: textAt("materialText") || null,
      certificates: textAt("certificates") || null,
      barcode,
      hsCode: textAt("hsCode") || null,
      countryOfOrigin: textAt("countryOfOrigin") || null,
      retailPrice: numberCell(
        row,
        headers.get("retailPrice"),
        "retailPrice",
        errors,
        { min: 0.01 },
      ),
      customsRate: numberCell(row, headers.get("customsRate"), "customsRate", errors, { min: 0 }),
      ananasBrokeragePct: numberCell(row, headers.get("ananasBrokeragePct"), "ananasBrokeragePct", errors, { min: 0 }),
      ananasStoragePct: numberCell(row, headers.get("ananasStoragePct"), "ananasStoragePct", errors, { min: 0 }),
      ananasDeliveryPct: numberCell(row, headers.get("ananasDeliveryPct"), "ananasDeliveryPct", errors, { min: 0 }),
      webCheck: booleanCell(row, headers.get("webCheck"), "webCheck", errors),
      wholesaleCheck: booleanCell(row, headers.get("wholesaleCheck"), "wholesaleCheck", errors),
      exportCheck: booleanCell(row, headers.get("exportCheck"), "exportCheck", errors),
      moq: numberCell(row, headers.get("moq"), "moq", errors, { integer: true, min: 0 }),
      newUntil: dateCell(row, headers.get("newUntil"), "newUntil", errors),
      familyCode: textAt("familyCode") || null,
      familyColorLabel: textAt("familyColorLabel") || null,
      familyColorHex: textAt("familyColorHex") || null,
      familyPosition: numberCell(
        row,
        headers.get("familyPosition"),
        "familyPosition",
        errors,
        { integer: true, min: 0 },
      ),
      familyPrimary: booleanCell(
        row,
        headers.get("familyPrimary"),
        "familyPrimary",
        errors,
      ),
      familyStorefrontEnabled: booleanCell(
        row,
        headers.get("familyStorefrontEnabled"),
        "familyStorefrontEnabled",
        errors,
      ),
    };
    rows.push(parsedRow);
  });
  if (!rows.length) {
    errors.push({ row: headerRow + 1, field: "file", message: "Datoteka nema artikle." });
  }

  if (headers.has("familyCode")) {
    const byFamily = new Map<string, ArticleImportRow[]>();
    for (const row of rows) {
      if (!row.familyCode) continue;
      try {
        row.familyCode = normalizeProductFamilyCode(row.familyCode);
        const derivedLabel = defaultProductFamilyLabel({
            colorPrimary: row.color1,
            colorSecondary: row.color2,
          });
        const familyColorLabel = row.familyColorLabel ?? (derivedLabel || null);
        if (headers.has("familyColorLabel") && !familyColorLabel) {
          throw new Error("Naziv boje je obavezan za član porodice.");
        }
        if (!row.sku && !familyColorLabel) {
          throw new Error("Novi SKU u porodici mora imati naziv boje.");
        }
        row.familyColorLabel = familyColorLabel
          ? normalizeProductFamilyLabel(familyColorLabel)
          : null;
        row.familyColorHex = normalizeProductFamilyHex(row.familyColorHex) ?? null;
      } catch (error) {
        errors.push({
          row: row.row,
          field: "familyCode",
          message: error instanceof Error ? error.message : "Podaci porodice nisu ispravni.",
        });
        continue;
      }
      const grouped = byFamily.get(row.familyCode) ?? [];
      grouped.push(row);
      byFamily.set(row.familyCode, grouped);
    }

    const sharedFields: ArticleImportColumn[] = [
      "shortName", "shortDescription", "description", "category", "group",
      "subgroup", "collection", "attribute1", "attribute2", "attribute3",
      "attribute4", "widthCm", "depthCm", "heightCm", "weightKg",
      "grossWeightKg", "unitPackWidthCm", "unitPackDepthCm",
      "unitPackHeightCm", "packQty", "palletQty", "packWidthCm", "packDepthCm",
      "packHeightCm", "packGrossWeightKg", "containerQty",
      "containerGrossWeightKg", "materialText", "webCheck",
      "wholesaleCheck", "exportCheck",
    ];
    for (const [familyCode, familyRows] of byFamily) {
      const labelRows = new Map<string, number>();
      for (const row of familyRows) {
        const labelKey = productFamilyLabelKey(row.familyColorLabel ?? "");
        const previousRow = labelRows.get(labelKey);
        if (previousRow) {
          errors.push({
            row: row.row,
            field: "familyColorLabel",
            message: `Naziv boje je već korišćen u redu ${previousRow} porodice ${familyCode}.`,
          });
        } else {
          labelRows.set(labelKey, row.row);
        }
      }
      const primaryRows = familyRows.filter((row) => row.familyPrimary === true);
      if (primaryRows.length > 1) {
        for (const row of primaryRows) {
          errors.push({
            row: row.row,
            field: "familyPrimary",
            message: `Porodica ${familyCode} može imati samo jednu glavnu boju.`,
          });
        }
      }
      const baseline = familyRows[0]!;
      for (const row of familyRows.slice(1)) {
        for (const field of sharedFields) {
          if (!headers.has(field)) continue;
          const left = baseline[field] instanceof Date
            ? baseline[field].toISOString()
            : baseline[field];
          const right = row[field] instanceof Date
            ? row[field].toISOString()
            : row[field];
          if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) {
            errors.push({
              row: row.row,
              field: String(field),
              message: `Konflikt zajedničkog podatka u porodici ${familyCode} (osnovni red ${baseline.row}).`,
            });
          }
        }
      }
    }
  }

  const suppliers = await db.supplier.findMany({
    select: { id: true, code: true, name: true },
  });
  const supplierByKey = new Map<string, string>();
  for (const supplier of suppliers) {
    supplierByKey.set(supplier.name.trim().toLocaleLowerCase("sr-Latn"), supplier.id);
    if (supplier.code) supplierByKey.set(supplier.code.trim().toLocaleLowerCase("sr-Latn"), supplier.id);
  }
  for (const row of rows) {
    if (
      row.supplier &&
      !supplierByKey.has(row.supplier.trim().toLocaleLowerCase("sr-Latn"))
    ) {
      errors.push({
        row: row.row,
        field: "supplier",
        message: `Dobavljač ${row.supplier} ne postoji; unesite ga u šifarnik dobavljača.`,
      });
    }
  }

  if (seenBarcodes.size) {
    const existing = await db.product.findMany({
      where: { barcode: { in: Array.from(seenBarcodes) } },
      select: { sku: true, barcode: true },
    });
    const incomingByBarcode = new Map(
      rows.filter((row) => row.barcode).map((row) => [row.barcode!, row]),
    );
    for (const product of existing) {
      const row = product.barcode ? incomingByBarcode.get(product.barcode) : null;
      if (row && row.sku !== product.sku) {
        errors.push({
          row: row.row,
          field: "barcode",
          message: `Bar kod već pripada artiklu ${product.sku}.`,
        });
      }
    }
  }
  const importedFamilyCodes = Array.from(
    new Set(rows.map((row) => row.familyCode).filter((code): code is string => Boolean(code))),
  );
  if (importedFamilyCodes.length) {
    const existingFamilies = await db.productFamily.findMany({
      where: { code: { in: importedFamilyCodes } },
      select: {
        code: true,
        members: {
          select: {
            labelKey: true,
            product: { select: { sku: true } },
          },
        },
      },
    });
    const existingByCode = new Map(existingFamilies.map((family) => [family.code, family]));
    for (const row of rows) {
      if (!row.familyCode || !row.familyColorLabel) continue;
      const conflict = existingByCode
        .get(row.familyCode)
        ?.members.find(
          (member) =>
            member.labelKey === productFamilyLabelKey(row.familyColorLabel!) &&
            member.product.sku !== row.sku,
        );
      if (conflict) {
        errors.push({
          row: row.row,
          field: "familyColorLabel",
          message: `Naziv boje već pripada SKU-u ${conflict.product.sku} u porodici ${row.familyCode}.`,
        });
      }
    }
  }
  const existingSkus = seenSkus.size
    ? await db.product.findMany({
        where: { sku: { in: Array.from(seenSkus) } },
        select: {
          sku: true,
          containerQty: true,
          unitPackWidthCm: true,
          unitPackDepthCm: true,
          unitPackHeightCm: true,
        },
      })
    : [];
  const existingSkuSet = new Set(existingSkus.map((product) => product.sku));
  const existingVolumeSourceBySku = new Map(
    existingSkus.map((product) => [product.sku, product]),
  );
  for (const row of rows) {
    if (!(row.sku && existingSkuSet.has(row.sku))) {
      for (const issue of validateNewArticleImportRequiredFields(row)) {
        errors.push({ row: row.row, field: issue.field, message: issue.message });
      }
    }
    const existing = row.sku
      ? existingVolumeSourceBySku.get(row.sku)
      : undefined;
    const prospectiveVolumeSource = {
      containerQty: headers.has("containerQty")
        ? row.containerQty
        : existing?.containerQty ?? null,
      unitPackWidthCm: headers.has("unitPackWidthCm")
        ? row.unitPackWidthCm
        : Number(existing?.unitPackWidthCm ?? 0),
      unitPackDepthCm: headers.has("unitPackDepthCm")
        ? row.unitPackDepthCm
        : Number(existing?.unitPackDepthCm ?? 0),
      unitPackHeightCm: headers.has("unitPackHeightCm")
        ? row.unitPackHeightCm
        : Number(existing?.unitPackHeightCm ?? 0),
    };
    if (!hasProductVolumeSource(prospectiveVolumeSource)) {
      errors.push({
        row: row.row,
        field: "containerQty",
        message:
          "Unesite količinu za ceo kontejner ili sve tri dimenzije pakovanja pojedinačnog artikla.",
      });
    }
  }
  if (errors.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "Cela datoteka je odbijena. Ispravite navedene redove i pokušajte ponovo.",
        errors,
        warnings,
        source,
      },
      { status: 422 },
    );
  }

  if (mode === "preview") {
    const familyCodes = Array.from(
      new Set(rows.map((row) => row.familyCode).filter((code): code is string => Boolean(code))),
    );
    const existingFamilies = familyCodes.length
      ? await db.productFamily.count({ where: { code: { in: familyCodes } } })
      : 0;
    return NextResponse.json({
      ok: true,
      preview: {
        rows: rows.length,
        creates: rows.filter((row) => !row.sku || !existingSkuSet.has(row.sku)).length,
        updates: rows.filter((row) => row.sku && existingSkuSet.has(row.sku)).length,
        families: familyCodes.length,
        newFamilies: familyCodes.length - existingFamilies,
        detachments: headers.has("familyCode")
          ? rows.filter((row) => !row.familyCode).length
          : 0,
      },
      warnings,
      source,
    });
  }

  const importedProductIds = new Set<string>();
  const importsPurchaseOrderLogistics = [
    "weightKg",
    "grossWeightKg",
    "unitPackWidthCm",
    "unitPackDepthCm",
    "unitPackHeightCm",
    "packQty",
    "packWidthCm",
    "packDepthCm",
    "packHeightCm",
    "packGrossWeightKg",
    "containerQty",
    "containerGrossWeightKg",
  ].some((field) => headers.has(field as ArticleImportColumn));

  try {
    await db.$transaction(async (tx) => {
      for (const row of rows) {
        const hasColumn = (field: ArticleImportColumn) => headers.has(field);
        const sku = row.sku ?? (await nextArticleSku(tx));
        const existing = row.sku
          ? await tx.product.findUnique({
              where: { sku: row.sku },
              include: {
                collection: { select: { id: true, name: true } },
                categories: {
                  take: 1,
                  include: {
                    category: {
                      include: {
                        parent: {
                          include: {
                            parent: { select: { id: true, name: true, slug: true } },
                          },
                        },
                      },
                    },
                  },
                },
                lookupAssignments: {
                  include: {
                    lookupValue: { select: { kind: true, value: true } },
                  },
                },
                familyMembership: {
                  select: {
                    label: true,
                    colorHex: true,
                    position: true,
                    storefrontEnabled: true,
                    family: { select: { code: true, primaryProductId: true } },
                  },
                },
              },
            })
          : null;
        if (row.sku && !existing) {
          await assertArticleSkuAvailable(tx, row.sku);
        }
        const collection = hasColumn("collection")
          ? await resolveNamedArticleRelation(tx, "collection", {
              name: row.collection,
            })
          : existing?.collection ?? null;
        const shouldReplaceCategory =
          hasColumn("category") || hasColumn("group") || hasColumn("subgroup");
        const currentCategory = existing?.categories[0]?.category ?? null;
        const currentRootCategory = currentCategory?.parent?.parent
          ? currentCategory.parent.parent
          : currentCategory?.parent ?? currentCategory;
        const currentGroupCategory = currentCategory?.parent?.parent
          ? currentCategory.parent
          : currentCategory?.parent
            ? currentCategory
            : null;
        const currentSubgroupCategory = currentCategory?.parent?.parent
          ? currentCategory
          : null;
        const rootCategory = hasColumn("category")
          ? row.category
            ? await resolveArticleCategory(tx, { name: row.category })
            : null
          : currentRootCategory;
        if (row.group && !rootCategory) {
          throw new Error(
            `Red ${row.row}: grupa ne može biti zadata bez kategorije.`,
          );
        }
        const groupCategory = hasColumn("group")
          ? row.group
            ? await resolveArticleCategory(tx, {
                name: row.group,
                parentId: rootCategory?.id ?? null,
              })
            : null
          : rootCategory?.id === currentRootCategory?.id
            ? currentGroupCategory
            : null;
        if (row.subgroup && !groupCategory) {
          throw new Error(
            `Red ${row.row}: podgrupa ne može biti zadata bez grupe.`,
          );
        }
        const subgroupCategory = hasColumn("subgroup")
          ? row.subgroup
            ? await resolveArticleCategory(tx, {
                name: row.subgroup,
                parentId: groupCategory?.id ?? null,
              })
            : null
          : groupCategory?.id === currentGroupCategory?.id
            ? currentSubgroupCategory
            : null;
        const category = subgroupCategory ?? groupCategory ?? rootCategory;
        const group = shouldReplaceCategory
          ? category
            ? await ensureCategoryGroup(tx, category)
            : null
          : existing?.groupId
            ? await tx.group.findUnique({
                where: { id: existing.groupId },
                select: { id: true, name: true, slug: true },
              })
            : null;
        const supplierId = hasColumn("supplier")
          ? row.supplier
            ? supplierByKey.get(row.supplier.trim().toLocaleLowerCase("sr-Latn")) ?? null
            : null
          : existing?.supplierId ?? null;
        const status = hasColumn("status")
          ? row.status ?? "UZ"
          : existing?.articleStatus ?? "UZ";
        const shortDescription = resolveImportedShortDescription({
          columnPresent: hasColumn("shortDescription"),
          incoming: row.shortDescription,
          current: existing?.shortDescription,
        });
        const { newUntil, newUntilAutomatic } =
          resolveAdminImportedProductNewness({
            columnPresent: hasColumn("newUntil"),
            incomingNewUntil: row.newUntil,
            existing,
          });
        const data = {
          barcode: hasColumn("barcode") ? row.barcode : existing?.barcode ?? null,
          name: composedArticleName({
            collectionName: collection?.name,
            shortDescription,
            shortName: row.shortName,
          }),
          shortName: row.shortName,
          shortDescription,
          description: resolveImportedFullDescription({
            columnPresent: hasColumn("description"),
            incoming: row.description,
            current: existing?.description,
          }),
          articleStatus: status,
          supplierId,
          groupId: group?.id ?? null,
          collectionId: collection?.id ?? null,
          attribute1: hasColumn("attribute1")
            ? row.attribute1
            : existing?.attribute1 ?? null,
          attribute2: hasColumn("attribute2")
            ? row.attribute2
            : existing?.attribute2 ?? null,
          attribute3: hasColumn("attribute3")
            ? row.attribute3
            : existing?.attribute3 ?? null,
          attribute4: hasColumn("attribute4")
            ? row.attribute4
            : existing?.attribute4 ?? null,
          colorPrimary: hasColumn("color1")
            ? row.color1
            : existing?.colorPrimary ?? null,
          colorSecondary: hasColumn("color2")
            ? row.color2
            : existing?.colorSecondary ?? null,
          incomingStock: existing?.incomingStock ?? 0,
          cogs: existing?.cogs ?? null,
          weightKg: hasColumn("weightKg")
            ? row.weightKg
            : existing?.weightKg ?? null,
          widthCm: hasColumn("widthCm") ? row.widthCm : existing?.widthCm ?? null,
          depthCm: hasColumn("depthCm") ? row.depthCm : existing?.depthCm ?? null,
          heightCm: hasColumn("heightCm") ? row.heightCm : existing?.heightCm ?? null,
          grossWeightKg: hasColumn("grossWeightKg")
            ? row.grossWeightKg
            : existing?.grossWeightKg ?? null,
          unitPackWidthCm: hasColumn("unitPackWidthCm")
            ? row.unitPackWidthCm
            : existing?.unitPackWidthCm ?? null,
          unitPackDepthCm: hasColumn("unitPackDepthCm")
            ? row.unitPackDepthCm
            : existing?.unitPackDepthCm ?? null,
          unitPackHeightCm: hasColumn("unitPackHeightCm")
            ? row.unitPackHeightCm
            : existing?.unitPackHeightCm ?? null,
          packQty: hasColumn("packQty") ? row.packQty : existing?.packQty ?? null,
          palletQty: hasColumn("palletQty")
            ? row.palletQty
            : existing?.palletQty ?? null,
          packWidthCm: hasColumn("packWidthCm")
            ? row.packWidthCm
            : existing?.packWidthCm ?? null,
          packDepthCm: hasColumn("packDepthCm")
            ? row.packDepthCm
            : existing?.packDepthCm ?? null,
          packHeightCm: hasColumn("packHeightCm")
            ? row.packHeightCm
            : existing?.packHeightCm ?? null,
          packGrossWeightKg: hasColumn("packGrossWeightKg")
            ? row.packGrossWeightKg
            : existing?.packGrossWeightKg ?? null,
          containerQty: hasColumn("containerQty")
            ? row.containerQty
            : existing?.containerQty ?? null,
          containerGrossWeightKg: hasColumn("containerGrossWeightKg")
            ? row.containerGrossWeightKg
            : existing?.containerGrossWeightKg ?? null,
          supplierProductName: hasColumn("supplierProductName")
            ? row.supplierProductName
            : existing?.supplierProductName ?? null,
          materialText: hasColumn("materialText")
            ? row.materialText
            : existing?.materialText ?? null,
          hsCode: hasColumn("hsCode") ? row.hsCode : existing?.hsCode ?? null,
          countryOfOrigin: hasColumn("countryOfOrigin")
            ? row.countryOfOrigin
            : existing?.countryOfOrigin ?? null,
          customsRate: hasColumn("customsRate")
            ? row.customsRate
            : existing?.customsRate ?? null,
          ananasBrokeragePct: hasColumn("ananasBrokeragePct")
            ? row.ananasBrokeragePct
            : existing?.ananasBrokeragePct ?? null,
          ananasStoragePct: hasColumn("ananasStoragePct")
            ? row.ananasStoragePct
            : existing?.ananasStoragePct ?? null,
          ananasDeliveryPct: hasColumn("ananasDeliveryPct")
            ? row.ananasDeliveryPct
            : existing?.ananasDeliveryPct ?? null,
          availableWebManual: row.webCheck ?? existing?.availableWebManual ?? true,
          availableWholesaleManual:
            row.wholesaleCheck ?? existing?.availableWholesaleManual ?? true,
          availableExportManual: row.exportCheck ?? existing?.availableExportManual ?? true,
          moq: hasColumn("moq") ? row.moq : existing?.moq ?? null,
          newUntil,
          newUntilAutomatic,
          isNew: productNewUntilIsActive(newUntil),
          fullPrice: existing?.fullPrice ?? row.retailPrice ?? 0,
          ...statusFlags(status),
          deletedAt:
            status === "ARH" ? existing?.deletedAt ?? new Date() : null,
        } satisfies Prisma.ProductUncheckedUpdateInput;
        const product = existing
          ? await tx.product.update({ where: { id: existing.id }, data })
          : await tx.product.create({
              data: {
                ...data,
                sku,
                slug: `${articleSlug(`${row.shortName}-${sku}`)}-${randomBytes(3).toString("hex")}`,
              },
            });
        importedProductIds.add(product.id);
        if (row.retailPrice !== null) {
          await upsertActiveRetailPrice(tx, {
            productId: product.id,
            price: row.retailPrice,
          });
        }
        if (
          (hasColumn("description") &&
            hasMeaningfulProductDescription(row.description)) ||
          (hasColumn("shortDescription") &&
            hasMeaningfulProductDescription(row.shortDescription))
        ) {
          await lockSupplierOwnedFields(tx, product.id, admin.id, ["description"]);
        }
        if (hasColumn("newUntil")) {
          await lockSupplierOwnedFields(tx, product.id, admin.id, ["flags"]);
        }
        if (shouldReplaceCategory) {
          await tx.productCategory.deleteMany({ where: { productId: product.id } });
          if (category) {
            await tx.productCategory.create({
              data: { productId: product.id, categoryId: category.id },
            });
          }
        }
        const hasLookupColumns = [
          "attribute1",
          "attribute2",
          "attribute3",
          "attribute4",
          "color1",
          "color2",
          "benefits",
          "certificates",
        ].some((field) => hasColumn(field as ArticleImportColumn));
        if (hasLookupColumns) {
          const existingBenefits =
            existing?.lookupAssignments
              .filter((item) => item.lookupValue.kind === "BENEFIT")
              .map((item) => item.lookupValue.value) ?? [];
          const existingCertificates =
            existing?.lookupAssignments
              .filter((item) => item.lookupValue.kind === "CERTIFICATE")
              .map((item) => item.lookupValue.value) ?? [];
          await syncArticleLookupAssignments(tx, product.id, {
            attributes: [
              product.attribute1,
              product.attribute2,
              product.attribute3,
              product.attribute4,
            ],
            colors: [product.colorPrimary, product.colorSecondary],
            benefits: hasColumn("benefits")
              ? row.benefits ?? ""
              : existingBenefits,
            certificates: hasColumn("certificates")
              ? row.certificates ?? ""
              : existingCertificates,
          });
        }
        if (hasColumn("photoUrl") && row.photoUrl) {
          const primaryMedia = await tx.productMedia.findFirst({
            where: { productId: product.id, kind: "IMAGE", syncStatus: "READY" },
            orderBy: { order: "asc" },
            select: { id: true },
          });
          const mediaData = {
            url: row.photoUrl,
            sourceUrl: row.photoUrl,
            thumbUrl: row.photoUrl,
            cardUrl: row.photoUrl,
            pdpUrl: row.photoUrl,
            alt: product.name,
            syncStatus: "READY" as const,
          };
          if (primaryMedia) {
            await tx.productMedia.update({
              where: { id: primaryMedia.id },
              data: mediaData,
            });
          } else {
            await tx.productMedia.create({
              data: {
                productId: product.id,
                kind: "IMAGE",
                order: 0,
                ...mediaData,
              },
            });
          }
        }
        if (hasColumn("familyCode")) {
          await setProductFamilyMembership(tx, {
            productId: product.id,
            familyCode: row.familyCode,
            label:
              (hasColumn("familyColorLabel")
                ? row.familyColorLabel
                : existing?.familyMembership?.label) ??
              defaultProductFamilyLabel({
                colorPrimary: product.colorPrimary,
                colorSecondary: product.colorSecondary,
              }),
            colorHex: hasColumn("familyColorHex")
              ? row.familyColorHex
              : existing?.familyMembership?.colorHex,
            position: hasColumn("familyPosition")
              ? row.familyPosition ?? 0
              : existing?.familyMembership?.position,
            storefrontEnabled: hasColumn("familyStorefrontEnabled")
              ? row.familyStorefrontEnabled ?? false
              : existing?.familyMembership?.storefrontEnabled ?? false,
            makePrimary: hasColumn("familyPrimary")
              ? row.familyPrimary ?? false
              : existing?.familyMembership?.family.primaryProductId === product.id,
          });
          if (row.familyCode) {
            await propagateProductFamilySharedData(tx, product.id);
          }
        }
        if (row.stock !== null) {
          await setDefaultWarehouseStock(tx, {
            idempotencyKey: `article-import:${file.name}:${row.row}:${sku}`,
            productId: product.id,
            targetQty: row.stock,
            actorId: admin.id,
            note: `XLSX uvoz: ${file.name}, red ${row.row}`,
          });
        }
      }
    });
  } catch (error) {
    const message =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
        ? "Jedinstvena vrednost (SKU, slug ili bar kod) već postoji."
        : error instanceof Error
          ? error.message
          : "Uvoz nije upisan; transakcija je vraćena.";
    return NextResponse.json(
      { ok: false, error: message, warnings, source },
      { status: 409 },
    );
  }

  if (importsPurchaseOrderLogistics) {
    await recomputeOpenPurchaseOrderLogisticsForProducts(
      Array.from(importedProductIds),
    );
  }

  await logAudit({
    actorId: admin.id,
    action: "erp.article.xlsx_import",
    entity: "Product",
    diff: {
      filename: file.name,
      rows: rows.length,
      worksheet: source.worksheet,
      headerRow: source.headerRow,
      familyCodes: Array.from(
        new Set(rows.map((row) => row.familyCode).filter((code): code is string => Boolean(code))),
      ),
    },
  });
  revalidateTag("catalog-products", "max");
  revalidatePath("/admin/erp/artikli");
  return NextResponse.json({ ok: true, imported: rows.length, warnings, source });
}
