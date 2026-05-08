import "server-only";

import { db } from "@/lib/db";

/**
 * Phase 4A item 7 — read-only health snapshots used by the admin XML
 * dashboard (Phase 5) and by ops scripts. Lives next to the importer so
 * the data shape evolves with it.
 */

export interface SupplierHealth {
  id: string;
  name: string;
  enabled: boolean;
  hasFeedUrl: boolean;
  hasMapping: boolean;
  productCount: number;
  activeProductCount: number;
  lastRun: {
    id: string;
    status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
    startedAt: Date;
    finishedAt: Date | null;
    recordsRead: number;
    recordsOk: number;
    recordsFail: number;
    errorMessage: string | null;
  } | null;
}

export async function getSupplierHealth(): Promise<SupplierHealth[]> {
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      enabled: true,
      feedUrl: true,
      mapping: true,
    },
  });

  return Promise.all(
    suppliers.map(async (s) => {
      const [productCount, activeProductCount, lastRun] = await Promise.all([
        db.product.count({ where: { supplierId: s.id } }),
        db.product.count({ where: { supplierId: s.id, isActive: true } }),
        db.importRun.findFirst({
          where: { supplierId: s.id },
          orderBy: { startedAt: "desc" },
        }),
      ]);
      return {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        hasFeedUrl: !!s.feedUrl,
        hasMapping: !!s.mapping,
        productCount,
        activeProductCount,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt,
              finishedAt: lastRun.finishedAt,
              recordsRead: lastRun.recordsRead,
              recordsOk: lastRun.recordsOk,
              recordsFail: lastRun.recordsFail,
              errorMessage: lastRun.errorMessage,
            }
          : null,
      } satisfies SupplierHealth;
    }),
  );
}

/** Latest stock snapshot per supplier+SKU; useful for the per-item drilldown. */
export async function getLatestStockSnapshots(supplierId: string, limit = 100) {
  return db.supplierStockSnapshot.findMany({
    where: { supplierId },
    orderBy: { capturedAt: "desc" },
    take: limit,
    select: {
      externalSku: true,
      stock: true,
      incomingStock: true,
      capturedAt: true,
      product: { select: { sku: true, name: true, isActive: true } },
    },
  });
}
