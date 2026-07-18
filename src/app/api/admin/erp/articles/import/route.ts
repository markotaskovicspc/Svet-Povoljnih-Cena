import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ArticleStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit, requireAdminAction } from "@/lib/admin";

type ImportError = { row: number; field: string; message: string };
type ArticleImportRow = {
  row: number;
  sku: string;
  name: string;
  description: string;
  fullPrice: number;
  barcode: string | null;
  status: ArticleStatus;
  stock: number;
  incomingStock: number;
  supplierCode: string | null;
  weightKg: number | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  packQty: number | null;
  packWidthCm: number | null;
  packDepthCm: number | null;
  packHeightCm: number | null;
  packGrossWeightKg: number | null;
  hsCode: string | null;
  moq: number | null;
};

const HEADER_ALIASES: Record<string, keyof ArticleImportRow> = {
  sku: "sku",
  sifra: "sku",
  sifraartikla: "sku",
  name: "name",
  naziv: "name",
  opis: "description",
  description: "description",
  mpc: "fullPrice",
  mpcena: "fullPrice",
  fullprice: "fullPrice",
  barcode: "barcode",
  barkod: "barcode",
  status: "status",
  zalihe: "stock",
  stock: "stock",
  udolasku: "incomingStock",
  incomingstock: "incomingStock",
  dobavljac: "supplierCode",
  suppliercode: "supplierCode",
  tezinakg: "weightKg",
  weightkg: "weightKg",
  sirinacm: "widthCm",
  widthcm: "widthCm",
  dubinacm: "depthCm",
  depthcm: "depthCm",
  visinacm: "heightCm",
  heightcm: "heightCm",
  kompak: "packQty",
  packqty: "packQty",
  paksirinacm: "packWidthCm",
  packwidthcm: "packWidthCm",
  pakdubinacm: "packDepthCm",
  packdepthcm: "packDepthCm",
  pakvisinacm: "packHeightCm",
  packheightcm: "packHeightCm",
  pakbrutokg: "packGrossWeightKg",
  packgrossweightkg: "packGrossWeightKg",
  hskod: "hsCode",
  hscode: "hsCode",
  moq: "moq",
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

function numberCell(
  row: ExcelJS.Row,
  column: number | undefined,
  field: string,
  errors: ImportError[],
  options: { required?: boolean; integer?: boolean; min?: number } = {},
) {
  if (!column) return null;
  const raw = cellText(row.getCell(column)).replace(/\s/g, "").replace(",", ".");
  if (!raw) {
    if (options.required) {
      errors.push({ row: row.number, field, message: "Polje je obavezno." });
    }
    return null;
  }
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

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
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
  for (const required of ["sku", "name", "description", "fullPrice"] as const) {
    if (!headers.has(required)) {
      errors.push({ row: 1, field: required, message: "Nedostaje obavezna kolona." });
    }
  }
  const rows: ArticleImportRow[] = [];
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  worksheet.eachRow((row, rowNumber) => {
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellText(cell)) hasValue = true;
    });
    if (rowNumber === 1 || !hasValue) return;
    const textAt = (field: keyof ArticleImportRow) => {
      const column = headers.get(field);
      return column ? cellText(row.getCell(column)) : "";
    };
    const sku = textAt("sku");
    const name = textAt("name");
    const description = textAt("description");
    const barcode = textAt("barcode") || null;
    const rawStatus = (textAt("status") || "SP").toUpperCase();
    const status = Object.values(ArticleStatus).includes(rawStatus as ArticleStatus)
      ? (rawStatus as ArticleStatus)
      : null;
    if (!sku) errors.push({ row: rowNumber, field: "sku", message: "SKU je obavezan." });
    if (!name) errors.push({ row: rowNumber, field: "name", message: "Naziv je obavezan." });
    if (!description) {
      errors.push({ row: rowNumber, field: "description", message: "Opis je obavezan." });
    }
    if (sku && seenSkus.has(sku)) {
      errors.push({ row: rowNumber, field: "sku", message: "SKU je dupliran u datoteci." });
    }
    if (barcode && seenBarcodes.has(barcode)) {
      errors.push({ row: rowNumber, field: "barcode", message: "Bar kod je dupliran u datoteci." });
    }
    if (!status) {
      errors.push({
        row: rowNumber,
        field: "status",
        message: "Status mora biti SP, IT, DTZ, DOB, ARH ili UZ.",
      });
    }
    seenSkus.add(sku);
    if (barcode) seenBarcodes.add(barcode);
    const fullPrice = numberCell(row, headers.get("fullPrice"), "fullPrice", errors, {
      required: true,
      min: 0.01,
    });
    const stock =
      numberCell(row, headers.get("stock"), "stock", errors, {
        integer: true,
        min: 0,
      }) ?? 0;
    const incomingStock =
      numberCell(row, headers.get("incomingStock"), "incomingStock", errors, {
        integer: true,
        min: 0,
      }) ?? 0;
    rows.push({
      row: rowNumber,
      sku,
      name,
      description,
      fullPrice: fullPrice ?? 0,
      barcode,
      status: status ?? "UZ",
      stock,
      incomingStock,
      supplierCode: textAt("supplierCode") || null,
      weightKg: numberCell(row, headers.get("weightKg"), "weightKg", errors, { min: 0 }),
      widthCm: numberCell(row, headers.get("widthCm"), "widthCm", errors, { min: 0 }),
      depthCm: numberCell(row, headers.get("depthCm"), "depthCm", errors, { min: 0 }),
      heightCm: numberCell(row, headers.get("heightCm"), "heightCm", errors, { min: 0 }),
      packQty: numberCell(row, headers.get("packQty"), "packQty", errors, {
        integer: true,
        min: 1,
      }),
      packWidthCm: numberCell(row, headers.get("packWidthCm"), "packWidthCm", errors, {
        min: 0,
      }),
      packDepthCm: numberCell(row, headers.get("packDepthCm"), "packDepthCm", errors, {
        min: 0,
      }),
      packHeightCm: numberCell(row, headers.get("packHeightCm"), "packHeightCm", errors, {
        min: 0,
      }),
      packGrossWeightKg: numberCell(
        row,
        headers.get("packGrossWeightKg"),
        "packGrossWeightKg",
        errors,
        { min: 0 },
      ),
      hsCode: textAt("hsCode") || null,
      moq: numberCell(row, headers.get("moq"), "moq", errors, {
        integer: true,
        min: 1,
      }),
    });
  });
  if (!rows.length) errors.push({ row: 2, field: "file", message: "Datoteka nema artikle." });

  const supplierCodes = Array.from(
    new Set(rows.map((row) => row.supplierCode).filter((value): value is string => Boolean(value))),
  );
  const suppliers = supplierCodes.length
    ? await db.supplier.findMany({
        where: { code: { in: supplierCodes } },
        select: { id: true, code: true },
      })
    : [];
  const supplierByCode = new Map(suppliers.map((supplier) => [supplier.code!, supplier.id]));
  for (const row of rows) {
    if (row.supplierCode && !supplierByCode.has(row.supplierCode)) {
      errors.push({
        row: row.row,
        field: "supplierCode",
        message: `Dobavljač ${row.supplierCode} ne postoji.`,
      });
    }
  }
  if (seenBarcodes.size) {
    const existing = await db.product.findMany({
      where: { barcode: { in: Array.from(seenBarcodes) } },
      select: { sku: true, barcode: true },
    });
    const incomingSkuByBarcode = new Map(
      rows.filter((row) => row.barcode).map((row) => [row.barcode!, row]),
    );
    for (const product of existing) {
      const row = product.barcode ? incomingSkuByBarcode.get(product.barcode) : null;
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
    await db.$transaction(
      rows.map((row) => {
        const isActive = row.status !== "ARH" && row.status !== "UZ";
        const data = {
          barcode: row.barcode,
          name: row.name,
          description: row.description,
          fullPrice: row.fullPrice,
          articleStatus: row.status,
          stock: row.stock,
          incomingStock: row.incomingStock,
          supplierId: row.supplierCode ? supplierByCode.get(row.supplierCode) : null,
          weightKg: row.weightKg,
          widthCm: row.widthCm,
          depthCm: row.depthCm,
          heightCm: row.heightCm,
          packQty: row.packQty,
          packWidthCm: row.packWidthCm,
          packDepthCm: row.packDepthCm,
          packHeightCm: row.packHeightCm,
          packGrossWeightKg: row.packGrossWeightKg,
          hsCode: row.hsCode,
          moq: row.moq,
          isActive,
          isDtz: row.status === "DTZ",
          isLimited: row.status === "IT",
          deletedAt: row.status === "ARH" ? new Date() : null,
        } satisfies Prisma.ProductUncheckedUpdateInput;
        return db.product.upsert({
          where: { sku: row.sku },
          update: data,
          create: {
            ...data,
            sku: row.sku,
            slug: slugify(`${row.name}-${row.sku}`),
          },
        });
      }),
    );
  } catch (error) {
    const message =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
        ? "Jedinstvena vrednost (SKU, slug ili bar kod) već postoji."
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
