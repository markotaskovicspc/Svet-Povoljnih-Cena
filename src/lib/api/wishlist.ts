import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";

/**
 * Wishlist + per-product alert toggles (Phase 3C — items 4 & 6).
 *
 * Two notification flavours per wishlist item:
 *   - `notifyOnSale`  → row in `OnSaleAlert` (fired when product enters action)
 *   - `notifyOnRestock` → row in `BackInStockAlert` (fired when stock > 0)
 *
 * Toggling on the wishlist row mirrors to the dedicated alert tables so the
 * dispatcher (Phase 4D) can scan a single source.
 */

export const alertChannelSchema = z.enum(["EMAIL", "SMS", "VIBER"]);
export type AlertChannel = z.infer<typeof alertChannelSchema>;

export async function listWishlist(userId: string) {
  const rows = await db.wishlistItem.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          slug: true,
          name: true,
          fullPrice: true,
          salePrice: true,
          discountPct: true,
          stock: true,
          incomingStock: true,
          isActive: true,
          media: { where: { kind: "IMAGE" }, orderBy: { order: "asc" }, take: 1 },
        },
      },
    },
  });
  return rows.map((w) => ({
    sku: w.product.sku,
    slug: w.product.slug,
    name: w.product.name,
    fullPrice: num(w.product.fullPrice),
    salePrice: w.product.salePrice ? num(w.product.salePrice) : null,
    discountPct: w.product.discountPct ?? 0,
    inStock: w.product.stock > 0,
    incoming: w.product.incomingStock > 0,
    isActive: w.product.isActive,
    thumbnailUrl: w.product.media[0]?.url ?? null,
    notifyOnSale: w.notifyOnSale,
    notifyOnRestock: w.notifyOnRestock,
    addedAt: w.addedAt.toISOString(),
  }));
}

/** Returns the new wishlist state for the SKU (true = added, false = removed). */
export async function toggleWishlist(userId: string, sku: string): Promise<boolean> {
  const product = await db.product.findUnique({ where: { sku }, select: { id: true } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const existing = await db.wishlistItem.findUnique({
    where: { userId_productId: { userId, productId: product.id } },
  });
  if (existing) {
    await db.wishlistItem.delete({ where: { id: existing.id } });
    // Tear down related alerts on removal so the user isn't notified for
    // something they no longer track.
    await db.backInStockAlert.deleteMany({ where: { userId, productId: product.id } });
    await db.onSaleAlert.deleteMany({ where: { userId, productId: product.id } });
    return false;
  }
  await db.wishlistItem.create({
    data: { userId, productId: product.id },
  });
  return true;
}

export async function setWishlistAlerts(
  userId: string,
  sku: string,
  flags: { notifyOnSale?: boolean; notifyOnRestock?: boolean },
  channel: AlertChannel = "EMAIL",
) {
  const product = await db.product.findUnique({ where: { sku }, select: { id: true } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const productId = product.id;

  return db.$transaction(async (tx) => {
    const item = await tx.wishlistItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId, ...flags },
      update: flags,
    });

    if (flags.notifyOnSale !== undefined) {
      if (flags.notifyOnSale) {
        await tx.onSaleAlert.upsert({
          where: { userId_productId_channel: { userId, productId, channel } },
          create: { userId, productId, channel },
          update: { notifiedAt: null },
        });
      } else {
        await tx.onSaleAlert.deleteMany({ where: { userId, productId } });
      }
    }
    if (flags.notifyOnRestock !== undefined) {
      if (flags.notifyOnRestock) {
        await tx.backInStockAlert.upsert({
          where: { userId_productId_channel: { userId, productId, channel } },
          create: { userId, productId, channel },
          update: { notifiedAt: null },
        });
      } else {
        await tx.backInStockAlert.deleteMany({ where: { userId, productId } });
      }
    }
    return item;
  });
}
