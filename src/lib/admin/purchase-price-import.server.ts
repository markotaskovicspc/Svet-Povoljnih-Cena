import "server-only";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SUPPLIER_PARITY_OPTIONS } from "@/lib/supplier-master";
import { composePurchasePriceAttributes, composePurchasePricePattern } from "./purchase-price";
import { articleSnapshotSelect, insertPurchasePriceInTransaction } from "./purchase-price.server";
import { MAX_PURCHASE_PRICE_IMPORT_BYTES, MAX_PURCHASE_PRICE_IMPORT_ROWS, parsePurchasePriceCsv, parsePurchasePriceImportRows, type PurchasePriceImportRow } from "./purchase-price-import";
import { verifyInventoryImportToken } from "./inventory-import-token";

export async function readPurchasePriceImportFile(file: File) {
  if (!file.size || file.size > MAX_PURCHASE_PRICE_IMPORT_BYTES) throw new Error("Datoteka mora biti neprazna i manja od 2 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  if (/\.csv$/i.test(file.name)) return { fileHash, rows: parsePurchasePriceCsv(bytes.toString("utf8")) };
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Dozvoljene su samo CSV i XLSX datoteke.");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes as never); } catch { throw new Error("XLSX datoteka nije ispravna ili je zaštićena lozinkom."); }
  const sheets = workbook.worksheets.filter(sheet => sheet.actualRowCount > 0);
  if (sheets.length !== 1) throw new Error("XLSX mora sadržati tačno jedan neprazan radni list.");
  const sheet = sheets[0];
  if (sheet.rowCount > MAX_PURCHASE_PRICE_IMPORT_ROWS + 1 || sheet.columnCount > 30) throw new Error(`XLSX može imati najviše ${MAX_PURCHASE_PRICE_IMPORT_ROWS} redova podataka i 30 kolona.`);
  const records: string[][] = [];
  for (let index = 1; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    records.push(Array.from({ length: sheet.columnCount }, (_, column) => {
      const cell = row.getCell(column + 1);
      if (cell.type === ExcelJS.ValueType.Formula) throw new Error(`Red ${index}: formule nisu dozvoljene. Nalepite vrednosti pre uvoza.`);
      if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
      return cell.text;
    }));
  }
  return { fileHash, rows: parsePurchasePriceImportRows(records) };
}

function previousDay(date: string) {
  const result = new Date(date); result.setUTCDate(result.getUTCDate() - 1); return result.toISOString().slice(0, 10);
}

export async function previewPurchasePriceImport(tx: Prisma.TransactionClient, input: PurchasePriceImportRow[]) {
  const requested = input.filter(row => !row.errors.length);
  const products = requested.length ? await tx.product.findMany({
    where: { deletedAt: null, OR: requested.map(row => ({ sku: { equals: row.sku, mode: "insensitive" as const } })) },
    select: { ...articleSnapshotSelect, supplier: { select: { id: true, code: true, name: true, currency: true, parity: true } } },
    orderBy: { id: "asc" },
  }) : [];
  const history = products.length ? await tx.purchasePrice.findMany({
    where: { productId: { in: products.map(product => product.id) } },
    orderBy: [{ validFrom: "asc" }, { id: "asc" }],
    select: { id: true, productId: true, price: true, validFrom: true, validTo: true, updatedAt: true },
  }) : [];
  const rows = input.map(row => {
    const errors = [...row.errors];
    const matches = products.filter(product => product.sku.toLowerCase() === row.sku.toLowerCase());
    const product = matches.length === 1 ? matches[0] : null;
    const supplier = product?.supplier;
    if (!errors.length) {
      if (!product) errors.push(matches.length ? "Šifra nije jednoznačna." : "Artikal nije pronađen.");
      else if (!supplier) errors.push("Artikal nema povezanog dobavljača.");
      else {
        if (!SUPPLIER_PARITY_OPTIONS.some(parity => parity === supplier.parity?.trim())) errors.push("Dobavljač nema ispravan paritet.");
        if (row.currency && row.currency !== supplier.currency) errors.push(`Valuta ne odgovara dobavljaču (${supplier.currency}).`);
        if (row.supplier && ![supplier.code, supplier.name].some(value => value?.toLowerCase() === row.supplier.toLowerCase())) errors.push("Dobavljač ne odgovara dobavljaču artikla.");
      }
    }
    const prices = history.filter(price => price.productId === product?.id);
    if (!errors.length && prices.some(price => price.validFrom.toISOString().slice(0, 10) === row.validFrom)) errors.push("Cena za ovu šifru i datum već postoji. Izmenite postojeći zapis ili odaberite novi datum.");
    const following = [
      ...prices.map(price => price.validFrom.toISOString().slice(0, 10)),
      ...input.filter(other => !other.errors.length && other.sku.toLowerCase() === row.sku.toLowerCase()).map(other => other.validFrom),
    ].filter(date => date > row.validFrom).sort()[0];
    const boundary = following ? previousDay(following) : "";
    const effectiveValidTo = boundary && (!row.validTo || row.validTo > boundary) ? boundary : row.validTo;
    const previous = prices.filter(price => price.validFrom.toISOString().slice(0, 10) < row.validFrom).at(-1);
    const closesPrevious = Boolean(previous && (!previous.validTo || previous.validTo.toISOString().slice(0, 10) >= row.validFrom));
    return { ...row, sku: product?.sku ?? row.sku, productId: product?.id ?? null, name: product?.name ?? "—", supplierName: supplier?.name ?? "—", resolvedCurrency: supplier?.currency ?? row.currency, effectiveValidTo, closesPrevious, errors };
  });
  const stateHash = createHash("sha256").update(JSON.stringify({ products, history, rows })).digest("hex");
  return { rows, stateHash, valid: rows.length > 0 && rows.every(row => !row.errors.length), products };
}

export async function applyPurchasePriceImport(input: { rows: PurchasePriceImportRow[]; fileHash: string; token: string; adminId: string }) {
  return db.$transaction(async tx => {
    const preview = await previewPurchasePriceImport(tx, input.rows);
    if (!preview.valid) throw new Error("Uvoz nije primenjen. Ispravite greške i ponovite pregled.");
    if (!verifyInventoryImportToken(input.token, { adminId: `purchase-prices:${input.adminId}`, fileHash: input.fileHash, stateHash: preview.stateHash })) throw new Error("Pregled je istekao ili su podaci promenjeni. Ponovite pregled pre primene.");
    const ids: string[] = [];
    for (const row of [...preview.rows].sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.sku.localeCompare(b.sku))) {
      const product = preview.products.find(product => product.id === row.productId)!;
      const supplier = product.supplier!;
      const created = await insertPurchasePriceInTransaction(tx, {
        productId: product.id, supplierId: supplier.id, sku: product.sku, name: product.name,
        attributes: composePurchasePriceAttributes(product), pattern: composePurchasePricePattern(product),
        currency: supplier.currency, parity: supplier.parity!.trim(),
      }, row.purchasePrice, new Date(row.validFrom), row.validTo ? new Date(row.validTo) : null);
      ids.push(created.id);
    }
    await tx.auditLog.create({ data: { actorId: input.adminId, action: "erp.purchase-prices.import", entity: "erp:nabavne-cene", diff: { count: ids.length, ids, fileHash: input.fileHash } } });
    return { count: ids.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
}
