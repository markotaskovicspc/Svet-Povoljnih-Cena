import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";
import { resolveRabaluxAvailability } from "@/lib/rabalux/availability";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { expandSetLines, isProductSetSku, productSetId, productSetSku, ProductSetError, setStock } from "./core";

export async function resolveSetBasket(lines: Array<{ sku: string; qty: number; withAssembly?: boolean }>) {
  const ids = lines.filter(l => isProductSetSku(l.sku)).map(l => productSetId(l.sku));
  if (!ids.length) return { lines, prices: new Map<string, number>(), names: new Map<string, string>(), versions: [] as Array<{ id: string; updatedAt: Date }> };
  const sets = ids.length ? await db.productSet.findMany({ where: { id: { in: ids } }, include: { components: { include: { product: { select: { sku: true } } }, orderBy: { position: "asc" } } } }) : [];
  const expanded = expandSetLines(lines, sets.map(s => ({ ...s, components: s.components.map(c => ({ sku: c.product.sku, quantity: c.quantity, unitPrice: Number(c.unitPrice) })) })));
  return { ...expanded, versions: sets.map(s => ({ id: s.id, updatedAt: s.updatedAt })) };
}

/** Hold definitions stable until stock and the immutable order snapshot are saved. */
export async function lockSetVersions(tx: Prisma.TransactionClient, versions: Array<{ id: string; updatedAt: Date }>) {
  if (!versions.length) return;
  const rows = await tx.$queryRaw<Array<{ id: string; updatedAt: Date; active: boolean }>>(Prisma.sql`SELECT "id", "updatedAt", "active" FROM "ProductSet" WHERE "id" IN (${Prisma.join(versions.map(v => v.id))}) ORDER BY "id" FOR SHARE`);
  for (const version of versions) if (!rows.some(r => r.id === version.id && r.active && r.updatedAt.getTime() === version.updatedAt.getTime())) throw new ProductSetError("Sastav ili cena seta su promenjeni. Osvežite korpu i pokušajte ponovo.");
}

export async function getPublicSets(filter?: { ids?: string[]; slug?: string }) {
  const sets = await db.productSet.findMany({ where: { active: true, ...(filter?.ids ? { id: { in: filter.ids } } : {}), ...(filter?.slug ? { slug: filter.slug } : {}) }, orderBy: { name: "asc" }, take: 100,
    include: { components: { orderBy: { position: "asc" }, include: { product: { include: { supplier: true, media: { where: { kind: "IMAGE" }, orderBy: { order: "asc" }, take: 1 } } } } } } });
  if (!sets.length) return [];
  const publicIds = new Set((await db.product.findMany({ where: { ...webStorefrontProductWhere(), id: { in: sets.flatMap(s => s.components.map(c => c.productId)) } }, select: { id: true } })).map(p => p.id));
  return sets.filter(s => s.components.length >= 2 && s.components.every(c => publicIds.has(c.productId))).map(s => {
    const components = s.components.map(c => {
      const p = c.product;
      const supplier = p.supplier?.integrationKey === "RABALUX";
      const available = !publicIds.has(p.id) ? 0 : supplier ? resolveRabaluxAvailability({ warehouseStock: p.dcAvailableQty, supplierStock: p.supplierStock, supplierReservedStock: p.supplierReservedStock, lastSupplierStockSyncAt: p.lastSupplierStockSyncAt, supplierOperational: isRabaluxSupplierOperational(p.supplier), supplierApproved: p.supplierApprovalStatus === "APPROVED" }).sellableStock : p.dcAvailableQty;
      return { sku: p.sku, name: p.name, slug: p.slug, quantity: c.quantity, unitPrice: Number(c.unitPrice), available, supplier, image: resolveSupabaseStorageUrl(getMediaVariantUrl(p.media[0], "thumb")) || null };
    });
    return { id: s.id, sku: productSetSku(s.id), name: s.name, slug: s.slug, description: s.description, price: Math.round(components.reduce((n, c) => n + c.unitPrice * 100 * c.quantity, 0)) / 100, stock: setStock(components), supplier: components.some(c => c.supplier), image: components.find(c => c.image)?.image ?? null, components };
  });
}
export type PublicProductSet = Awaited<ReturnType<typeof getPublicSets>>[number];
