import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  CHANNEL_SAFETY_STOCK,
  resolveChannelAvailability,
} from "@/lib/channel-availability";

async function defaultWarehouse(tx: Prisma.TransactionClient) {
  const existing = await tx.warehouse.findFirst({
    where: { active: true, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return tx.warehouse.upsert({
    where: { code: "DC" },
    create: {
      code: "DC",
      name: "Distributivni centar",
      active: true,
      isDefault: true,
    },
    update: { active: true, isDefault: true },
  });
}

export async function syncProductChannelAvailability(
  tx: Prisma.TransactionClient,
  productId: string,
) {
  const warehouse = await defaultWarehouse(tx);
  const [product, stock, warehouseStockCount, partnerReservations] = await Promise.all([
    tx.product.findUnique({
      where: { id: productId },
      select: {
        stock: true,
        availableWebManual: true,
        availableWholesaleManual: true,
        availableExportManual: true,
      },
    }),
    tx.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId,
        },
      },
      select: { qty: true },
    }),
    tx.warehouseStock.count({ where: { productId } }),
    tx.partnerReservation.aggregate({
      where: {
        productId,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: [
          {
            OR: [{ warehouseId: warehouse.id }, { warehouseId: null }],
          },
        ],
      },
      _sum: { qty: true },
    }),
  ]);
  if (!product) throw new Error("Proizvod ne postoji.");
  const dcPhysical = stock?.qty ?? (warehouseStockCount ? 0 : product.stock);
  const dcAvailable = Math.max(
    dcPhysical - (partnerReservations._sum.qty ?? 0),
    0,
  );
  const effective = resolveChannelAvailability({
    physical: dcAvailable,
    manualWeb: product.availableWebManual,
    manualWholesale: product.availableWholesaleManual,
    manualExport: product.availableExportManual,
  });
  await tx.product.update({
    where: { id: productId },
    data: {
      dcAvailableQty: dcAvailable,
      availableWebAuto: dcAvailable > CHANNEL_SAFETY_STOCK.web,
      availableWholesaleAuto: dcAvailable > CHANNEL_SAFETY_STOCK.wholesale,
      availableExportAuto: dcAvailable > CHANNEL_SAFETY_STOCK.export,
    },
  });
  return {
    dcAvailable,
    webAuto: dcAvailable > CHANNEL_SAFETY_STOCK.web,
    wholesaleAuto: dcAvailable > CHANNEL_SAFETY_STOCK.wholesale,
    exportAuto: dcAvailable > CHANNEL_SAFETY_STOCK.export,
    web: effective.web,
    wholesale: effective.wholesale,
    export: effective.export,
  };
}

export async function syncAllProductChannelAvailability(
  tx: Prisma.TransactionClient,
) {
  const products = await tx.product.findMany({ select: { id: true } });
  for (const product of products) {
    await syncProductChannelAvailability(tx, product.id);
  }
  return products.length;
}

export async function expirePartnerReservations(limit = 500) {
  const expired = await db.partnerReservation.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lte: new Date() },
    },
    orderBy: { expiresAt: "asc" },
    take: Math.min(Math.max(limit, 1), 2_000),
    select: { id: true, productId: true },
  });
  if (!expired.length) return { released: 0, products: 0 };
  const productIds = Array.from(new Set(expired.map((row) => row.productId)));
  const released = await db.$transaction(async (tx) => {
    const updated = await tx.partnerReservation.updateMany({
      where: { id: { in: expired.map((row) => row.id) }, status: "ACTIVE" },
      data: { status: "RELEASED" },
    });
    for (const productId of productIds) {
      await syncProductChannelAvailability(tx, productId);
    }
    return updated.count;
  });
  return { released, products: productIds.length };
}
