import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ArticleStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";
import {
  composedArticleName,
  nextArticleSku,
  resolveArticleCategory,
  resolveNamedArticleRelation,
  syncArticleLookupAssignments,
} from "@/lib/admin/article-master.server";
import { articleSlug, optionalDateInput } from "@/lib/article-master";
import { sanitizeRichText } from "@/lib/rich-text";
import { setDefaultWarehouseStock } from "@/lib/inventory";

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
  incomingStock: number | null;
  cogs: number | null;
  weightKg: number | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  grossWeightKg: number | null;
  packQty: number | null;
  packWidthCm: number | null;
  packDepthCm: number | null;
  packHeightCm: number | null;
  packGrossWeightKg: number | null;
  supplierProductName: string | null;
  materialText: string | null;
  certificates: string | null;
  barcode: string | null;
  hsCode: string | null;
  customsRate: number | null;
  ananasBrokeragePct: number | null;
  ananasStoragePct: number | null;
  ananasDeliveryPct: number | null;
  webCheck: boolean | null;
  wholesaleCheck: boolean | null;
  exportCheck: boolean | null;
  moq: number | null;
  newUntil: Date | null;
  tncFrom: Date | null;
  tncUntil: Date | null;
  fullPrice: number | null;
};

const HEADER_ALIASES: Record<string, keyof ArticleImportRow> = {
  sku: "sku",
  sifra: "sku",
  sifraartikla: "sku",
  photo: "photoUrl",
  photourl: "photoUrl",
  image: "photoUrl",
  imageurl: "photoUrl",
  foto: "photoUrl",
  fotografija: "photoUrl",
  fotografijazasajt: "photoUrl",
  urlfotografije: "photoUrl",
  status: "status",
  statusartikla: "status",
  supplier: "supplier",
  dobavljac: "supplier",
  suppliercode: "supplier",
  category: "category",
  kategorija: "category",
  kategorijaartikala: "category",
  subgroup: "subgroup",
  podgrupa: "subgroup",
  podgrupaartikla: "subgroup",
  group: "group",
  grupa: "group",
  grupaartikla: "group",
  collection: "collection",
  kolekcija: "collection",
  shortdescription: "shortDescription",
  kratkiopis: "shortDescription",
  kratkiopisartikla: "shortDescription",
  shortname: "shortName",
  name: "shortName",
  naziv: "shortName",
  kratkinaziv: "shortName",
  kratkinazivartikla: "shortName",
  attribute1: "attribute1",
  atribut1: "attribute1",
  attribute2: "attribute2",
  atribut2: "attribute2",
  attribute3: "attribute3",
  atribut3: "attribute3",
  attribute4: "attribute4",
  atribut4: "attribute4",
  color1: "color1",
  boja1: "color1",
  color2: "color2",
  boja2: "color2",
  benefits: "benefits",
  benefiti: "benefits",
  siteDescription: "description",
  sitedescription: "description",
  description: "description",
  opis: "description",
  opiszasajt: "description",
  stock: "stock",
  zalihe: "stock",
  fizickostanje: "stock",
  ukupnofizickostanje: "stock",
  incomingstock: "incomingStock",
  udolasku: "incomingStock",
  kolicinaudolasku: "incomingStock",
  cogs: "cogs",
  weightkg: "weightKg",
  tezinakg: "weightKg",
  tezinaartikla: "weightKg",
  widthcm: "widthCm",
  sirinacm: "widthCm",
  sirinaartikla: "widthCm",
  depthcm: "depthCm",
  dubinacm: "depthCm",
  dubinaartikla: "depthCm",
  heightcm: "heightCm",
  visinacm: "heightCm",
  visinaartikla: "heightCm",
  grossweightkg: "grossWeightKg",
  brutotezinakg: "grossWeightKg",
  brutotezina: "grossWeightKg",
  brutotezinaartikla: "grossWeightKg",
  packqty: "packQty",
  kompak: "packQty",
  brojartikalaupakovanju: "packQty",
  packwidthcm: "packWidthCm",
  paksirinacm: "packWidthCm",
  paksirina: "packWidthCm",
  sirinatransportnogpakovanja: "packWidthCm",
  packdepthcm: "packDepthCm",
  pakdubinacm: "packDepthCm",
  pakdubina: "packDepthCm",
  dubinatransportnogpakovanja: "packDepthCm",
  packheightcm: "packHeightCm",
  pakvisinacm: "packHeightCm",
  pakvisina: "packHeightCm",
  visinatransportnogpakovanja: "packHeightCm",
  packgrossweightkg: "packGrossWeightKg",
  pakbrutokg: "packGrossWeightKg",
  brutotezinatransportnogpakovanja: "packGrossWeightKg",
  suppliername: "supplierProductName",
  dobavljacevnaziv: "supplierProductName",
  material: "materialText",
  certificates: "certificates",
  sertifikati: "certificates",
  barcode: "barcode",
  barkod: "barcode",
  hscode: "hsCode",
  hskod: "hsCode",
  customsrate: "customsRate",
  carina: "customsRate",
  ananasbrokerage: "ananasBrokeragePct",
  ananasposred: "ananasBrokeragePct",
  ananasprovizijazaposredovanje: "ananasBrokeragePct",
  ananasstorage: "ananasStoragePct",
  ananasskladis: "ananasStoragePct",
  ananasprovizijazaskladistenje: "ananasStoragePct",
  ananasdelivery: "ananasDeliveryPct",
  ananasispor: "ananasDeliveryPct",
  ananasprovizijazaisporuku: "ananasDeliveryPct",
  webcheck: "webCheck",
  wholesalecheck: "wholesaleCheck",
  vpcheck: "wholesaleCheck",
  exportcheck: "exportCheck",
  inocheck: "exportCheck",
  moq: "moq",
  newuntil: "newUntil",
  novodo: "newUntil",
  tncfrom: "tncFrom",
  tncod: "tncFrom",
  tcfrom: "tncFrom",
  tcod: "tncFrom",
  tncuntil: "tncUntil",
  tncdo: "tncUntil",
  tcuntil: "tncUntil",
  tcdo: "tncUntil",
  fullprice: "fullPrice",
  mpc: "fullPrice",
  mpcena: "fullPrice",
};

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

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
  const raw = normalizeHeader(cellText(row.getCell(column)));
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
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return NextResponse.json({ ok: false, error: "XLSX nema radni list." }, { status: 400 });
  }

  const headers = new Map<keyof ArticleImportRow, number>();
  worksheet.getRow(1).eachCell((cell, column) => {
    const field = HEADER_ALIASES[normalizeHeader(cellText(cell))];
    if (field) headers.set(field, column);
  });
  const errors: ImportError[] = [];
  if (!headers.has("shortName")) {
    errors.push({ row: 1, field: "shortName", message: "Nedostaje kolona Kratki naziv." });
  }

  const rows: ArticleImportRow[] = [];
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellText(cell)) hasValue = true;
    });
    if (!hasValue) return;
    const textAt = (field: keyof ArticleImportRow) => {
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
      incomingStock: numberCell(row, headers.get("incomingStock"), "incomingStock", errors, { integer: true, min: 0 }),
      cogs: numberCell(row, headers.get("cogs"), "cogs", errors, { min: 0 }),
      weightKg: numberCell(row, headers.get("weightKg"), "weightKg", errors, { min: 0 }),
      widthCm: numberCell(row, headers.get("widthCm"), "widthCm", errors, { min: 0 }),
      depthCm: numberCell(row, headers.get("depthCm"), "depthCm", errors, { min: 0 }),
      heightCm: numberCell(row, headers.get("heightCm"), "heightCm", errors, { min: 0 }),
      grossWeightKg: numberCell(row, headers.get("grossWeightKg"), "grossWeightKg", errors, { min: 0 }),
      packQty: numberCell(row, headers.get("packQty"), "packQty", errors, { integer: true, min: 0 }),
      packWidthCm: numberCell(row, headers.get("packWidthCm"), "packWidthCm", errors, { min: 0 }),
      packDepthCm: numberCell(row, headers.get("packDepthCm"), "packDepthCm", errors, { min: 0 }),
      packHeightCm: numberCell(row, headers.get("packHeightCm"), "packHeightCm", errors, { min: 0 }),
      packGrossWeightKg: numberCell(row, headers.get("packGrossWeightKg"), "packGrossWeightKg", errors, { min: 0 }),
      supplierProductName: textAt("supplierProductName") || null,
      materialText: textAt("materialText") || null,
      certificates: textAt("certificates") || null,
      barcode,
      hsCode: textAt("hsCode") || null,
      customsRate: numberCell(row, headers.get("customsRate"), "customsRate", errors, { min: 0 }),
      ananasBrokeragePct: numberCell(row, headers.get("ananasBrokeragePct"), "ananasBrokeragePct", errors, { min: 0 }),
      ananasStoragePct: numberCell(row, headers.get("ananasStoragePct"), "ananasStoragePct", errors, { min: 0 }),
      ananasDeliveryPct: numberCell(row, headers.get("ananasDeliveryPct"), "ananasDeliveryPct", errors, { min: 0 }),
      webCheck: booleanCell(row, headers.get("webCheck"), "webCheck", errors),
      wholesaleCheck: booleanCell(row, headers.get("wholesaleCheck"), "wholesaleCheck", errors),
      exportCheck: booleanCell(row, headers.get("exportCheck"), "exportCheck", errors),
      moq: numberCell(row, headers.get("moq"), "moq", errors, { integer: true, min: 0 }),
      newUntil: dateCell(row, headers.get("newUntil"), "newUntil", errors),
      tncFrom: dateCell(row, headers.get("tncFrom"), "tncFrom", errors),
      tncUntil: dateCell(row, headers.get("tncUntil"), "tncUntil", errors),
      fullPrice: numberCell(row, headers.get("fullPrice"), "fullPrice", errors, { min: 0 }),
    };
    if (
      parsedRow.tncFrom &&
      parsedRow.tncUntil &&
      parsedRow.tncFrom > parsedRow.tncUntil
    ) {
      errors.push({
        row: rowNumber,
        field: "tncFrom",
        message: "T&C datum od ne može biti posle datuma do.",
      });
    }
    rows.push(parsedRow);
  });
  if (!rows.length) errors.push({ row: 2, field: "file", message: "Datoteka nema artikle." });

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
  if (errors.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "Cela datoteka je odbijena. Ispravite navedene redove i pokušajte ponovo.",
        errors,
      },
      { status: 422 },
    );
  }

  try {
    await db.$transaction(async (tx) => {
      for (const row of rows) {
        const hasColumn = (field: keyof ArticleImportRow) => headers.has(field);
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
                      include: { parent: { select: { id: true, name: true } } },
                    },
                  },
                },
                lookupAssignments: {
                  include: {
                    lookupValue: { select: { kind: true, value: true } },
                  },
                },
              },
            })
          : null;
        const [group, collection] = await Promise.all([
          hasColumn("group")
            ? resolveNamedArticleRelation(tx, "group", { name: row.group })
            : existing?.groupId
              ? tx.group.findUnique({
                  where: { id: existing.groupId },
                  select: { id: true, name: true },
                })
              : null,
          hasColumn("collection")
            ? resolveNamedArticleRelation(tx, "collection", { name: row.collection })
            : existing?.collection ?? null,
        ]);
        const shouldReplaceCategory =
          hasColumn("category") || hasColumn("subgroup");
        const currentCategory = existing?.categories[0]?.category ?? null;
        const parentCategory = hasColumn("category")
          ? row.category
            ? await resolveArticleCategory(tx, { name: row.category })
            : null
          : currentCategory?.parent ?? currentCategory;
        const category = hasColumn("subgroup")
          ? row.subgroup
            ? await resolveArticleCategory(tx, {
                name: row.subgroup,
                parentId: parentCategory?.id ?? null,
              })
            : parentCategory
          : parentCategory;
        const supplierId = hasColumn("supplier")
          ? row.supplier
            ? supplierByKey.get(row.supplier.trim().toLocaleLowerCase("sr-Latn")) ?? null
            : null
          : existing?.supplierId ?? null;
        const status = hasColumn("status")
          ? row.status ?? "UZ"
          : existing?.articleStatus ?? "UZ";
        const shortDescription = hasColumn("shortDescription")
          ? row.shortDescription
          : existing?.shortDescription ?? null;
        const newUntil = hasColumn("newUntil")
          ? row.newUntil
          : existing?.newUntil ?? null;
        const activeDateFloor = new Date();
        activeDateFloor.setHours(0, 0, 0, 0);
        const data = {
          barcode: hasColumn("barcode") ? row.barcode : existing?.barcode ?? null,
          name: composedArticleName({
            collectionName: collection?.name,
            shortDescription,
            shortName: row.shortName,
          }),
          shortName: row.shortName,
          shortDescription,
          description: hasColumn("description")
            ? sanitizeRichText(row.description ?? "")
            : existing?.description ?? "",
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
          incomingStock: row.incomingStock ?? existing?.incomingStock ?? 0,
          cogs: hasColumn("cogs") ? row.cogs : existing?.cogs ?? null,
          weightKg: hasColumn("weightKg")
            ? row.weightKg
            : existing?.weightKg ?? null,
          widthCm: hasColumn("widthCm") ? row.widthCm : existing?.widthCm ?? null,
          depthCm: hasColumn("depthCm") ? row.depthCm : existing?.depthCm ?? null,
          heightCm: hasColumn("heightCm") ? row.heightCm : existing?.heightCm ?? null,
          grossWeightKg: hasColumn("grossWeightKg")
            ? row.grossWeightKg
            : existing?.grossWeightKg ?? null,
          packQty: hasColumn("packQty") ? row.packQty : existing?.packQty ?? null,
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
          supplierProductName: hasColumn("supplierProductName")
            ? row.supplierProductName
            : existing?.supplierProductName ?? null,
          materialText: hasColumn("materialText")
            ? row.materialText
            : existing?.materialText ?? null,
          hsCode: hasColumn("hsCode") ? row.hsCode : existing?.hsCode ?? null,
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
          isNew: hasColumn("newUntil")
            ? Boolean(newUntil && newUntil >= activeDateFloor)
            : existing?.isNew ?? false,
          tncFrom: hasColumn("tncFrom") ? row.tncFrom : existing?.tncFrom ?? null,
          tncUntil: hasColumn("tncUntil")
            ? row.tncUntil
            : existing?.tncUntil ?? null,
          fullPrice: row.fullPrice ?? existing?.fullPrice ?? 0,
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
        ].some((field) => hasColumn(field as keyof ArticleImportRow));
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
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }

  await logAudit({
    actorId: admin.id,
    action: "erp.article.xlsx_import",
    entity: "Product",
    diff: { filename: file.name, rows: rows.length },
  });
  return NextResponse.json({ ok: true, imported: rows.length });
}
