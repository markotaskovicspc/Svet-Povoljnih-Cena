import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { formatProductDisplayName } from "@/lib/product-name";
import { hasStorefrontIncomingStock } from "@/lib/storefront-incoming";

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

export const wishlistSyncPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1).max(64),
        notifyOnSale: z.boolean().optional().default(false),
        notifyOnRestock: z.boolean().optional().default(false),
      }),
    )
    .max(100),
});

export type WishlistSyncItem = z.infer<
  typeof wishlistSyncPayloadSchema
>["items"][number];

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
          sizeLabel: true,
          fullPrice: true,
          salePrice: true,
          discountPct: true,
          stock: true,
          incomingStock: true,
          supplier: { select: { integrationKey: true } },
          isActive: true,
          media: { where: { kind: "IMAGE" }, orderBy: { order: "asc" }, take: 1 },
        },
      },
    },
  });
  return rows.map((w) => ({
    sku: w.product.sku,
    slug: w.product.slug,
    name: formatProductDisplayName(w.product.name, w.product.sizeLabel),
    fullPrice: num(w.product.fullPrice),
    salePrice: w.product.salePrice ? num(w.product.salePrice) : null,
    discountPct: w.product.discountPct ?? 0,
    inStock: w.product.stock > 0,
    incoming: hasStorefrontIncomingStock({
      incomingStock: w.product.incomingStock,
      supplierIntegrationKey: w.product.supplier?.integrationKey,
    }),
    isActive: w.product.isActive,
    thumbnailUrl:
      resolveSupabaseStorageUrl(getMediaVariantUrl(w.product.media[0], "thumb")) ||
      null,
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

/**
 * Reconciles a customer's complete wishlist with the durable database copy.
 * Existing rows keep their original `addedAt`, while removals also tear down
 * their matching alerts. Alert upserts deliberately preserve `notifiedAt`.
 */
export async function replaceWishlist(
  userId: string,
  items: WishlistSyncItem[],
) {
  const requestedBySku = new Map(items.map((item) => [item.sku, item]));
  const products = requestedBySku.size
    ? await db.product.findMany({
        where: { sku: { in: [...requestedBySku.keys()] }, deletedAt: null },
        select: { id: true, sku: true },
      })
    : [];
  const desired = products.map((product) => ({
    productId: product.id,
    ...requestedBySku.get(product.sku)!,
  }));
  const desiredProductIds = desired.map((item) => item.productId);

  await db.$transaction(async (tx) => {
    const removed = await tx.wishlistItem.findMany({
      where: {
        userId,
        ...(desiredProductIds.length
          ? { productId: { notIn: desiredProductIds } }
          : {}),
      },
      select: { productId: true },
    });
    const removedProductIds = removed.map((item) => item.productId);
    if (removedProductIds.length) {
      await tx.backInStockAlert.deleteMany({
        where: { userId, productId: { in: removedProductIds } },
      });
      await tx.onSaleAlert.deleteMany({
        where: { userId, productId: { in: removedProductIds } },
      });
      await tx.wishlistItem.deleteMany({
        where: { userId, productId: { in: removedProductIds } },
      });
    }

    for (const item of desired) {
      await tx.wishlistItem.upsert({
        where: {
          userId_productId: { userId, productId: item.productId },
        },
        create: {
          userId,
          productId: item.productId,
          notifyOnSale: item.notifyOnSale,
          notifyOnRestock: item.notifyOnRestock,
        },
        update: {
          notifyOnSale: item.notifyOnSale,
          notifyOnRestock: item.notifyOnRestock,
        },
      });

      if (item.notifyOnSale) {
        await tx.onSaleAlert.upsert({
          where: {
            userId_productId_channel: {
              userId,
              productId: item.productId,
              channel: "EMAIL",
            },
          },
          create: { userId, productId: item.productId, channel: "EMAIL" },
          update: {},
        });
      } else {
        await tx.onSaleAlert.deleteMany({
          where: { userId, productId: item.productId },
        });
      }

      if (item.notifyOnRestock) {
        await tx.backInStockAlert.upsert({
          where: {
            userId_productId_channel: {
              userId,
              productId: item.productId,
              channel: "EMAIL",
            },
          },
          create: { userId, productId: item.productId, channel: "EMAIL" },
          update: {},
        });
      } else {
        await tx.backInStockAlert.deleteMany({
          where: { userId, productId: item.productId },
        });
      }
    }
  });
}

/**
 * Adds a login snapshot without deleting anything already saved by another
 * tab. Alert preferences are monotonic during promotion: an enabled alert in
 * either snapshot remains enabled.
 */
export async function mergeWishlist(
  userId: string,
  items: WishlistSyncItem[],
) {
  const requestedBySku = new Map(items.map((item) => [item.sku, item]));

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('spc-wishlist'), hashtext(${userId}))::text AS "lock"`;
    const products = requestedBySku.size
      ? await tx.product.findMany({
          where: { sku: { in: [...requestedBySku.keys()] }, deletedAt: null },
          select: { id: true, sku: true },
        })
      : [];

    for (const product of products) {
      const requested = requestedBySku.get(product.sku)!;
      const current = await tx.wishlistItem.findUnique({
        where: { userId_productId: { userId, productId: product.id } },
        select: { notifyOnSale: true, notifyOnRestock: true },
      });
      const notifyOnSale = Boolean(
        requested.notifyOnSale || current?.notifyOnSale,
      );
      const notifyOnRestock = Boolean(
        requested.notifyOnRestock || current?.notifyOnRestock,
      );

      await tx.wishlistItem.upsert({
        where: { userId_productId: { userId, productId: product.id } },
        create: {
          userId,
          productId: product.id,
          notifyOnSale,
          notifyOnRestock,
        },
        update: { notifyOnSale, notifyOnRestock },
      });
      if (notifyOnSale) {
        await tx.onSaleAlert.upsert({
          where: {
            userId_productId_channel: {
              userId,
              productId: product.id,
              channel: "EMAIL",
            },
          },
          create: { userId, productId: product.id, channel: "EMAIL" },
          update: {},
        });
      }
      if (notifyOnRestock) {
        await tx.backInStockAlert.upsert({
          where: {
            userId_productId_channel: {
              userId,
              productId: product.id,
              channel: "EMAIL",
            },
          },
          create: { userId, productId: product.id, channel: "EMAIL" },
          update: {},
        });
      }
    }
  });
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
