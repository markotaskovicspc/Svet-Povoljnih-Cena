import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  authenticatePartner,
  partnerRateLimitHeaders,
} from "@/lib/partners/auth";

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
          warehouse: { select: { code: true, name: true, isDefault: true } },
        },
      },
      partnerReservations: {
        where: {
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { qty: true },
      },
      updatedAt: true,
    },
  });

  const items = products.map((product) => {
    const physical = product.warehouseStocks.reduce((sum, stock) => sum + stock.qty, 0);
    const reserved = product.partnerReservations.reduce(
      (sum, reservation) => sum + reservation.qty,
      0,
    );
    const available = Math.max(physical - reserved, 0);
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
      warehouses: product.warehouseStocks.map((stock) => ({
        code: stock.warehouse.code,
        name: stock.warehouse.name,
        isDc: stock.warehouse.isDefault,
        physical: stock.qty,
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
