import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  authenticatePartner,
  partnerRateLimitHeaders,
} from "@/lib/partners/auth";
import { resolveStoredWarehouseBalance } from "@/lib/reservation-stock";

export async function GET(request: Request) {
  const auth = await authenticatePartner(request, "inventory:read");
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      {
        status: auth.status,
        headers: auth.rateLimit ? partnerRateLimitHeaders(auth.rateLimit) : undefined,
      },
    );
  }

  const search = new URL(request.url).searchParams;
  const cursor = search.get("cursor")?.trim() || undefined;
  const sku = search.get("sku")?.trim() || undefined;
  const products = await db.product.findMany({
    take: 100,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    where: {
      deletedAt: null,
      ...(sku ? { sku } : {}),
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      incomingStock: true,
      availableWebManual: true,
      availableWholesaleManual: true,
      availableExportManual: true,
      availableWebAuto: true,
      availableWholesaleAuto: true,
      availableExportAuto: true,
      dcAvailableQty: true,
      warehouseStocks: {
        where: { warehouse: { active: true } },
        select: {
          qty: true,
          warehouse: {
            select: { id: true, code: true, name: true, isDefault: true },
          },
        },
      },
      orderItems: {
        where: {
          warehouseReservedQty: { gt: 0 },
          order: { status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] } },
        },
        select: {
          warehouseId: true,
          warehouseReservedQty: true,
          stockMovements: {
            select: { qty: true },
          },
        },
      },
      partnerReservations: {
        where: {
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { warehouseId: true, qty: true },
      },
      updatedAt: true,
    },
  });

  const items = products.map((product) => {
    const warehouses = product.warehouseStocks.map((stock) => {
      const balance = resolveStoredWarehouseBalance({
        storedQty: stock.qty,
        orderReservations: product.orderItems
          .filter(
            (reservation) =>
              reservation.warehouseId === stock.warehouse.id ||
              (reservation.warehouseId === null && stock.warehouse.isDefault),
          )
          .map((reservation) => ({
            qty: reservation.warehouseReservedQty,
            debited:
              reservation.stockMovements.reduce(
                (sum, movement) => sum + movement.qty,
                0,
              ) < 0,
          })),
        partnerReserved: product.partnerReservations
          .filter(
            (reservation) => reservation.warehouseId === stock.warehouse.id,
          )
          .reduce((sum, reservation) => sum + reservation.qty, 0),
      });
      return { stock, balance };
    });
    const physical = warehouses.reduce(
      (sum, warehouse) => sum + warehouse.balance.physical,
      0,
    );
    const reserved = warehouses.reduce(
      (sum, warehouse) => sum + warehouse.balance.reserved,
      0,
    );
    const available = warehouses.reduce(
      (sum, warehouse) => sum + warehouse.balance.available,
      0,
    );
    return {
      sku: product.sku,
      name: product.name,
      physical,
      reserved,
      available,
      dcAvailable: product.dcAvailableQty,
      incoming: product.incomingStock,
      channels: {
        web: product.availableWebManual && product.availableWebAuto,
        wholesale:
          product.availableWholesaleManual && product.availableWholesaleAuto,
        export: product.availableExportManual && product.availableExportAuto,
      },
      warehouses: warehouses.map(({ stock, balance }) => ({
        code: stock.warehouse.code,
        name: stock.warehouse.name,
        isDc: stock.warehouse.isDefault,
        physical: balance.physical,
        reserved: balance.reserved,
        available: balance.available,
      })),
      updatedAt: product.updatedAt.toISOString(),
    };
  });

  await db.auditLog.create({
    data: {
      action: "partner.inventory.read",
      entity: "PartnerApiClient",
      entityId: auth.client.id,
      diff: { sku: sku ?? null, rows: items.length },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      items,
      nextCursor: products.length === 100 ? products.at(-1)?.id ?? null : null,
    },
    { headers: partnerRateLimitHeaders(auth.rateLimit) },
  );
}
