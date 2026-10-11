import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calculateUnitLogistics, isPackQuantityValid, roundLogisticsVolume } from "@/lib/admin/purchase-order";
import { recomputePurchaseOrderTotals } from "@/lib/admin/po";
import { recomputeIncomingStockForPurchaseOrders } from "@/lib/admin/incoming-stock.server";
import { parsePurchaseOrderImportRows, type PurchaseOrderImportRow } from "./purchase-order-import";

export async function purchaseOrderImportPreview(tx: Prisma.TransactionClient, orderId: string, input: PurchaseOrderImportRow[]) {
  // Validate again at the persistence boundary, including direct server callers.
  const validated = parsePurchaseOrderImportRows([["Šifra", "Količina"], ...input.map(row => [row.sku, String(row.qty)])]);
  validated.forEach((row, i) => { row.row = input[i].row; });
  const order = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { supplier: true, items: { orderBy: { id: "asc" } } } });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.lockedAt || order.status !== "DRAFT") throw new Error("Uvoz je moguć samo u neproknjiženu porudžbenicu u statusu U obradi.");
  if (!order.supplierId || !order.supplier?.enabled || !order.orderDate) throw new Error("Pre uvoza sačuvajte aktivnog dobavljača i datum porudžbenice.");
  const products = await tx.product.findMany({
    where: { deletedAt: null, OR: validated.map(row => ({ sku: { equals: row.sku, mode: "insensitive" as const } })) },
    include: {
      supplier: true,
      lookupAssignments: { where: { lookupValue: { kind: "CERTIFICATE", active: true } }, include: { lookupValue: true } },
      purchasePrices: {
        where: { validFrom: { lte: order.orderDate }, OR: [{ validTo: null }, { validTo: { gte: order.orderDate } }] },
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      },
    },
  });
  const items: Prisma.PurchaseOrderItemCreateManyInput[] = [];
  const rows = validated.map(row => {
    const matches = products.filter(product => product.sku.toLowerCase() === row.sku.toLowerCase());
    const product = matches.length === 1 ? matches[0] : undefined;
    const price = product?.purchasePrices.find(candidate => !candidate.supplierId || candidate.supplierId === product.supplierId);
    const parity = price?.parity ?? product?.supplier?.parity ?? null;
    let error: string | null = null;
    if (!product) error = matches.length ? "Šifra nije jednoznačna." : "Šifra nije pronađena.";
    else if (product.supplierId !== order.supplierId) error = "Artikal ne pripada dobavljaču porudžbenice.";
    else if (order.items.some(item => item.productId === product.id || item.sku.toLowerCase() === product.sku.toLowerCase())) error = "Artikal već postoji u porudžbenici. Količinu izmenite u postojećoj stavci.";
    else if (!price) error = "Nema važeće nabavne cene za datum porudžbenice.";
    else if (price.currency !== order.currency) error = `Valuta cene ${price.currency} nije valuta porudžbenice ${order.currency}.`;
    else if (parity !== order.parity) error = "Paritet nabavne cene nije paritet porudžbenice.";
    else if (product.moq && row.qty < product.moq) error = `Minimalna količina (MOQ) je ${product.moq}.`;
    else if (!isPackQuantityValid(row.qty, product.packQty)) error = `Količina mora biti deljiva pakovanjem (${product.packQty}).`;
    if (!error && product && price) {
      const logistics = calculateUnitLogistics({
        containerQty: product.containerQty, containerGrossWeightKg: Number(product.containerGrossWeightKg ?? 0),
        packQty: product.packQty, packWidthCm: Number(product.packWidthCm ?? 0), packDepthCm: Number(product.packDepthCm ?? 0), packHeightCm: Number(product.packHeightCm ?? 0),
        weightKg: Number(product.weightKg ?? 0), grossWeightKg: Number(product.grossWeightKg ?? 0), packGrossWeightKg: Number(product.packGrossWeightKg ?? 0),
      });
      items.push({
        purchaseOrderId: order.id, productId: product.id, sku: product.sku, name: product.name,
        attributes: [product.attribute1, product.attribute2, product.attribute3, product.attribute4, product.sizeLabel].filter((value, i, all) => value && all.indexOf(value) === i).join(" / ") || null,
        pattern: [product.colorPrimary, product.colorSecondary].filter(Boolean).join(" + ") || null,
        purchasePrice: price.price, currency: price.currency, parity, priceValidFrom: price.validFrom,
        moq: product.moq, packQty: product.packQty, qty: row.qty,
        totalVolume: roundLogisticsVolume(logistics.volumeM3 * row.qty), totalWeight: Number((logistics.weightKg * row.qty).toFixed(3)),
        customsRate: product.customsRate, calcRetailPrice: product.fullPrice, supplierProductName: product.supplierProductName,
        certificates: product.lookupAssignments.map(assignment => assignment.lookupValue.value).sort().join(", ") || null, barcode: product.barcode,
      });
    }
    return { ...row, sku: product?.sku ?? row.sku, name: product?.name ?? "—", price: price ? Number(price.price) : null, currency: price?.currency ?? null, parity, priceValidFrom: price?.validFrom.toISOString().slice(0, 10) ?? null, error };
  });
  const newTotal = items.reduce((sum, item) => sum + Number(item.purchasePrice) * item.qty, order.items.reduce((sum, item) => sum + Number(item.purchasePrice) * item.qty, 0));
  if (newTotal > 9_999_999_999.99) throw new Error("Ukupna vrednost porudžbenice prelazi dozvoljeni iznos.");
  // Full line snapshots cover changes to product logistics and commercial master data.
  const fingerprint = createHash("sha256").update(JSON.stringify({ order, rows, items })).digest("hex");
  return { rows, items, fingerprint, valid: rows.every(row => !row.error), orderNumber: order.number, supplierName: order.supplier.name, orderDate: order.orderDate.toISOString().slice(0, 10), currency: order.currency };
}

export async function applyPurchaseOrderImport(orderId: string, rows: PurchaseOrderImportRow[], fingerprint: string) {
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
      const preview = await purchaseOrderImportPreview(tx, orderId, rows);
      if (preview.fingerprint !== fingerprint) throw new Error("Podaci su se promenili od pregleda. Ponovite pregled datoteke.");
      if (!preview.valid) throw new Error("Uvoz sadrži greške. Ispravite sve redove i ponovite pregled.");
      await tx.purchaseOrderItem.createMany({ data: preview.items });
      await recomputePurchaseOrderTotals(orderId, tx);
      await recomputeIncomingStockForPurchaseOrders(tx, [orderId]);
      return rows.length;
    }, { isolationLevel: "Serializable", timeout: 60_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new Error("Porudžbenica ili cene su istovremeno promenjene. Ponovite pregled datoteke.");
    throw error;
  }
}
