import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { actionSalePriceError } from "@/lib/pricing/action-price";
import type { ActionPriceImportRow } from "./action-price-import";
export async function actionPriceImportPreview(tx: Prisma.TransactionClient, actionId: string, rows: ActionPriceImportRow[]) {
  const action = await tx.action.findUnique({ where: { id: actionId }, select: { id: true, startsAt: true, endsAt: true, isPermanent: true } });
  if (!action) throw new Error("Akcija nije pronađena.");
  if (action.isPermanent) throw new Error("Uvoz akcijskih cena nije namenjen trajno niskim cenama.");
  const products = await tx.product.findMany({ where: { deletedAt: null, OR: rows.map(row => ({ sku: { equals: row.sku, mode: "insensitive" as const } })) }, select: { id: true, sku: true, name: true, fullPrice: true } });
  const ids = products.map(p => p.id);
  const [prices, existing] = await Promise.all([
    tx.priceListEntry.findMany({ where: {
      productId: { in: ids }, validFrom: { lte: action.startsAt }, OR: [{ validTo: null }, { validTo: { gte: action.startsAt } }],
      priceList: { is: { kind: "RETAIL", active: true, AND: [
        { OR: [{ name: { contains: "MP", mode: "insensitive" } }, { code: { contains: "MP", mode: "insensitive" } }] },
        { OR: [{ validFrom: null }, { validFrom: { lte: action.startsAt } }] },
        { OR: [{ validTo: null }, { validTo: { gte: action.startsAt } }] },
      ] } },
    }, orderBy: [{ validFrom: "desc" }, { id: "asc" }], select: { productId: true, price: true } }),
    tx.actionProduct.findMany({ where: { actionId, productId: { in: ids } }, select: { productId: true, salePrice: true } }),
  ]);
  const result = rows.map(row => {
    const matches = products.filter(p => p.sku.toLowerCase() === row.sku.toLowerCase());
    const product = matches.length === 1 ? matches[0] : undefined;
    const regularPrice = product ? Number(prices.find(p => p.productId === product.id)?.price ?? product.fullPrice) : null;
    const old = existing.find(p => p.productId === product?.id);
    const error = !product ? (matches.length ? "Šifra nije jednoznačna." : "Šifra nije pronađena.") : actionSalePriceError(row.salePrice, regularPrice!);
    return { ...row, sku: product?.sku ?? row.sku, productId: product?.id ?? null, name: product?.name ?? "—", regularPrice, previousPrice: old?.salePrice == null ? null : Number(old.salePrice), exists: Boolean(old), error };
  });
  const fingerprint = createHash("sha256").update(JSON.stringify({ action, rows: result })).digest("hex");
  return { rows: result, fingerprint, valid: result.every(row => !row.error) };
}
