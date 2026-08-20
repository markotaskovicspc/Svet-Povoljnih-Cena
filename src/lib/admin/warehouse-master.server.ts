import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeWarehouseDetails } from "@/lib/admin/warehouse-master";
import {
  warehouseArchiveBlocker,
  warehouseDeleteBlocker,
} from "@/lib/admin/warehouse-archive";

const MAX_CREATE_ATTEMPTS = 4;

function nextWarehouseCode(codes: string[]) {
  const highestSerial = codes.reduce((highest, code) => {
    const match = /^MAG-(\d+)$/i.exec(code);
    if (!match) return highest;
    return Math.max(highest, Number.parseInt(match[1], 10));
  }, 0);
  return `MAG-${String(highestSerial + 1).padStart(3, "0")}`;
}

function isRetryableCreateError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export async function createWarehouseWithAutomaticCode(
  input: Record<string, unknown>,
) {
  const details = normalizeWarehouseDetails(input);

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const [warehouses, activeDefaultCount] = await Promise.all([
            tx.warehouse.findMany({ select: { code: true } }),
            tx.warehouse.count({ where: { active: true, isDefault: true } }),
          ]);
          const becomesDefault = activeDefaultCount === 0;
          if (becomesDefault) {
            await tx.warehouse.updateMany({
              where: { isDefault: true },
              data: { isDefault: false },
            });
          }
          return tx.warehouse.create({
            data: {
              code: nextWarehouseCode(warehouses.map((warehouse) => warehouse.code)),
              ...details,
              active: true,
              isDefault: becomesDefault,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (attempt < MAX_CREATE_ATTEMPTS && isRetryableCreateError(error)) continue;
      throw error;
    }
  }

  throw new Error("Magacin nije kreiran. Pokušajte ponovo.");
}

function uniqueWarehouseIds(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) throw new Error("Izaberite bar jedan magacin.");
  return unique;
}

export async function archiveWarehouses(ids: string[]) {
  const warehouseIds = uniqueWarehouseIds(ids);
  return db.$transaction(
    async (tx) => {
      const now = new Date();
      const warehouses = await tx.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: {
          id: true,
          name: true,
          active: true,
          isDefault: true,
          stocks: {
            where: { qty: { not: 0 } },
            take: 1,
            select: { id: true },
          },
          orderItems: {
            where: {
              warehouseReservedQty: { gt: 0 },
              order: { status: { notIn: ["OTKAZANO", "VRACENO"] } },
            },
            take: 1,
            select: { id: true },
          },
          partnerReservations: {
            where: {
              status: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            take: 1,
            select: { id: true },
          },
          purchaseOrdersReceiving: {
            where: { status: { in: ["DRAFT", "SENT", "CONFIRMED"] } },
            take: 1,
            select: { id: true },
          },
          inboundInvoicesReceiving: {
            where: { status: { in: ["DRAFT", "RECEIVED"] } },
            take: 1,
            select: { id: true },
          },
          outgoingDispatchNotes: {
            where: { status: "DRAFT" },
            take: 1,
            select: { id: true },
          },
          incomingDispatchNotes: {
            where: { status: "DRAFT" },
            take: 1,
            select: { id: true },
          },
          stockCounts: {
            where: { status: "DRAFT" },
            take: 1,
            select: { id: true },
          },
        },
      });

      if (warehouses.length !== warehouseIds.length) {
        throw new Error("Jedan od izabranih magacina više ne postoji.");
      }

      const activeWarehouses = warehouses.filter((warehouse) => warehouse.active);
      for (const warehouse of activeWarehouses) {
        const blocker = warehouseArchiveBlocker({
          name: warehouse.name,
          isDefault: warehouse.isDefault,
          hasStock: warehouse.stocks.length > 0,
          hasOrderReservations: warehouse.orderItems.length > 0,
          hasPartnerReservations: warehouse.partnerReservations.length > 0,
          hasIncomingDocuments:
            warehouse.purchaseOrdersReceiving.length > 0 ||
            warehouse.inboundInvoicesReceiving.length > 0,
          hasOpenDispatches:
            warehouse.outgoingDispatchNotes.length > 0 ||
            warehouse.incomingDispatchNotes.length > 0,
          hasOpenStockCounts: warehouse.stockCounts.length > 0,
        });
        if (blocker) throw new Error(blocker);
      }

      if (activeWarehouses.length) {
        await tx.warehouse.updateMany({
          where: { id: { in: activeWarehouses.map((warehouse) => warehouse.id) } },
          data: { active: false },
        });
      }
      return activeWarehouses.map((warehouse) => warehouse.name);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function restoreWarehouses(ids: string[]) {
  const warehouseIds = uniqueWarehouseIds(ids);
  const existing = await db.warehouse.findMany({
    where: { id: { in: warehouseIds } },
    select: { id: true, active: true },
  });
  if (existing.length !== warehouseIds.length) {
    throw new Error("Jedan od izabranih magacina više ne postoji.");
  }
  const archivedIds = existing
    .filter((warehouse) => !warehouse.active)
    .map((warehouse) => warehouse.id);
  if (archivedIds.length) {
    await db.warehouse.updateMany({
      where: { id: { in: archivedIds } },
      data: { active: true },
    });
  }
  return archivedIds.length;
}

export async function deleteWarehouses(ids: string[]) {
  const warehouseIds = uniqueWarehouseIds(ids);
  return db.$transaction(
    async (tx) => {
      const warehouses = await tx.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: {
          id: true,
          name: true,
          active: true,
          isDefault: true,
          _count: {
            select: {
              stocks: true,
              movements: true,
              fiscalDocuments: true,
              orderItems: true,
              purchaseOrdersReceiving: true,
              inboundInvoicesReceiving: true,
              outgoingDispatchNotes: true,
              incomingDispatchNotes: true,
              stockCounts: true,
              partnerReservations: true,
              reclamations: true,
              reclamationShipments: true,
            },
          },
        },
      });

      if (warehouses.length !== warehouseIds.length) {
        throw new Error("Jedan od izabranih magacina više ne postoji.");
      }

      for (const warehouse of warehouses) {
        const referenceCount = Object.values(warehouse._count).reduce(
          (sum, count) => sum + count,
          0,
        );
        const blocker = warehouseDeleteBlocker({
          name: warehouse.name,
          active: warehouse.active,
          isDefault: warehouse.isDefault,
          referenceCount,
        });
        if (blocker) throw new Error(blocker);
      }

      const deleted = await tx.warehouse.deleteMany({
        where: { id: { in: warehouseIds }, active: false, isDefault: false },
      });
      if (deleted.count !== warehouseIds.length) {
        throw new Error(
          "Magacin je u međuvremenu izmenjen. Osvežite stranicu i pokušajte ponovo.",
        );
      }
      return warehouses.map((warehouse) => warehouse.name);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
