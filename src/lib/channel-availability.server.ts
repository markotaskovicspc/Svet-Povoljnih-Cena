import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  CHANNEL_SAFETY_STOCK,
  resolveChannelAvailability,
} from "@/lib/channel-availability";
import {
  rabaluxStockFreshAfter,
  resolveRabaluxAvailability,
} from "@/lib/rabalux/availability";
import {
  isRabaluxEnabled,
  isRabaluxSupplierOperational,
} from "@/lib/rabalux/config";
import { resolveStoredWarehouseBalance } from "@/lib/reservation-stock";

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
  // Transaction clients use one physical connection. Avoid Promise.all here:
  // concurrent submissions are queued by PostgreSQL and can outlive the
  // interactive transaction timeout under load.
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      stock: true,
      availableWebManual: true,
      availableWholesaleManual: true,
      availableExportManual: true,
      supplierStock: true,
      supplierReservedStock: true,
      supplierApprovalStatus: true,
      lastSupplierStockSyncAt: true,
      supplier: {
        select: { integrationKey: true, enabled: true },
      },
    },
  });
  const stock = await tx.warehouseStock.findUnique({
    where: {
      warehouseId_productId: {
        warehouseId: warehouse.id,
        productId,
      },
    },
    select: { qty: true },
  });
  const warehouseStockCount = await tx.warehouseStock.count({
    where: { productId },
  });
  const partnerReservations = await tx.partnerReservation.aggregate({
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
  });
  const orderReservations = await tx.orderItem.findMany({
    where: {
      productId,
      warehouseReservedQty: { gt: 0 },
      OR: [{ warehouseId: warehouse.id }, { warehouseId: null }],
      order: {
        status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] },
      },
    },
    select: {
      warehouseReservedQty: true,
      stockMovements: {
        select: { qty: true },
      },
    },
  });
  if (!product) throw new Error("Proizvod ne postoji.");
  const dcBalance = resolveStoredWarehouseBalance({
    storedQty: stock?.qty ?? (warehouseStockCount ? 0 : product.stock),
    orderReservations: orderReservations.map((reservation) => ({
      qty: reservation.warehouseReservedQty,
      debited:
        reservation.stockMovements.reduce(
          (sum, movement) => sum + movement.qty,
          0,
        ) < 0,
    })),
    partnerReserved: partnerReservations._sum.qty ?? 0,
  });
  const dcAvailable = dcBalance.available;
  const effective = resolveChannelAvailability({
    physical: dcAvailable,
    manualWeb: product.availableWebManual,
    manualWholesale: product.availableWholesaleManual,
    manualExport: product.availableExportManual,
  });
  const rabaluxAvailability = resolveRabaluxAvailability({
    warehouseStock: dcAvailable,
    supplierStock: product.supplierStock,
    supplierReservedStock: product.supplierReservedStock,
    lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
    supplierOperational: isRabaluxSupplierOperational(product.supplier),
    supplierApproved: product.supplierApprovalStatus === "APPROVED",
  });
  const webAuto =
    product.supplier?.integrationKey === "RABALUX"
      ? rabaluxAvailability.sellableStock > CHANNEL_SAFETY_STOCK.web
      : dcAvailable > CHANNEL_SAFETY_STOCK.web;
  await tx.product.update({
    where: { id: productId },
    data: {
      dcAvailableQty: dcAvailable,
      availableWebAuto: webAuto,
      availableWholesaleAuto: dcAvailable > CHANNEL_SAFETY_STOCK.wholesale,
      availableExportAuto: dcAvailable > CHANNEL_SAFETY_STOCK.export,
    },
  });
  return {
    dcAvailable,
    supplierAvailable: rabaluxAvailability.supplierAvailable,
    webAuto,
    wholesaleAuto: dcAvailable > CHANNEL_SAFETY_STOCK.wholesale,
    exportAuto: dcAvailable > CHANNEL_SAFETY_STOCK.export,
    web: effective.web,
    wholesale: effective.wholesale,
    export: effective.export,
  };
}

export async function expireStaleRabaluxWebAvailability(now = new Date()) {
  const staleWhere = isRabaluxEnabled()
    ? {
        OR: [
          { lastSupplierStockSyncAt: null },
          { lastSupplierStockSyncAt: { lt: rabaluxStockFreshAfter(now) } },
          { supplierApprovalStatus: null },
          { supplierApprovalStatus: { not: "APPROVED" as const } },
          { supplier: { is: { integrationKey: "RABALUX", enabled: false } } },
        ],
      }
    : {};
  const result = await db.product.updateMany({
    where: {
      deletedAt: null,
      availableWebAuto: true,
      supplier: { is: { integrationKey: "RABALUX" } },
      ...staleWhere,
    },
    data: { availableWebAuto: false },
  });
  return result.count;
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
