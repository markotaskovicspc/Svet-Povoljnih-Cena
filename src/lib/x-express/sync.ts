import "server-only";

import { Prisma, type ShipmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { applyShipmentEvent } from "@/lib/courier/registry";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";
import { XExpressClient } from "./client";
import { X_EXPRESS_PROVIDER, requireXExpressEnabled } from "./config";
import type {
  XExpressMunicipality,
  XExpressStatusCode,
  XExpressStreet,
  XExpressTown,
  XExpressTrackingEvent,
} from "./types";

/**
 * Number of upserts issued concurrently against the DB. The dictionary datasets
 * are large (towns ~4.7k, streets far more) and issuing one awaited upsert per
 * row serially made a full sync take ~27+ minutes — long past any serverless/
 * cron timeout (Bug #11). Chunked concurrency keeps upsert semantics identical
 * while collapsing the wall-clock time by roughly this factor. Kept modest so we
 * don't exhaust the connection pool.
 */
const SYNC_UPSERT_CONCURRENCY = 20;

async function runChunked<T>(
  items: readonly T[],
  worker: (item: T) => Promise<unknown>,
  concurrency = SYNC_UPSERT_CONCURRENCY,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.all(chunk.map(worker));
  }
}

export async function syncXExpressDictionaries() {
  const cfg = requireXExpressEnabled();
  const client = new XExpressClient(cfg);
  const municipalities = await syncXExpressMunicipalities(client);
  const [towns, statuses] = await Promise.all([
    syncXExpressTowns(client),
    syncXExpressStatuses(client),
  ]);
  const streets = await syncXExpressStreets(client);
  return { municipalities, towns, streets, statuses };
}

export async function syncXExpressLocations(client = new XExpressClient()) {
  return syncXExpressTowns(client);
}

export async function syncXExpressMunicipalities(client = new XExpressClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "LOCATIONS" },
  });
  try {
    const municipalities = await client.fetchMunicipalities();
    await upsertMunicipalities(municipalities);
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        recordsRead: municipalities.length,
        recordsOk: municipalities.length,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, count: municipalities.length };
  } catch (err) {
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Nepoznata greška.",
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

export async function syncXExpressTowns(client = new XExpressClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "LOCATIONS" },
  });
  try {
    const towns = await client.fetchTowns();
    await upsertTowns(towns);
    await mirrorTownsToLegacyLocationCache(towns);
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        recordsRead: towns.length,
        recordsOk: towns.length,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, count: towns.length };
  } catch (err) {
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Nepoznata greška.",
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

export async function syncXExpressStreets(client = new XExpressClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "LOCATIONS" },
  });
  try {
    const streets = await client.fetchStreets();
    await upsertStreets(streets);
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        recordsRead: streets.length,
        recordsOk: streets.length,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, count: streets.length };
  } catch (err) {
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Nepoznata greška.",
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

async function upsertMunicipalities(municipalities: XExpressMunicipality[]) {
  const seenIds = municipalities.map((m) => m.id);
  await runChunked(municipalities, (municipality) =>
    db.xExpressMunicipality.upsert({
      where: { id: municipality.id },
      create: {
        id: municipality.id,
        name: municipality.name,
        postalCode: municipality.postalCode ?? null,
        priority: municipality.priority ?? null,
        active: true,
        raw: municipality.raw as Prisma.InputJsonValue,
      },
      update: {
        name: municipality.name,
        postalCode: municipality.postalCode ?? null,
        priority: municipality.priority ?? null,
        active: true,
        raw: municipality.raw as Prisma.InputJsonValue,
        syncedAt: new Date(),
      },
    }),
  );
  if (seenIds.length) {
    await db.xExpressMunicipality.updateMany({
      where: { id: { notIn: seenIds } },
      data: { active: false },
    });
  }
}

async function upsertTowns(towns: XExpressTown[]) {
  const seenIds = towns.map((t) => t.id);
  await runChunked(towns, (town) =>
    db.xExpressTown.upsert({
      where: { id: town.id },
      create: {
        id: town.id,
        name: town.name,
        displayName: town.displayName ?? null,
        municipalityId: town.municipalityId ?? null,
        postalCode: town.postalCode ?? null,
        priority: town.priority ?? null,
        cutOffPickupTime: town.cutOffPickupTime ?? null,
        active: true,
        raw: town.raw as Prisma.InputJsonValue,
      },
      update: {
        name: town.name,
        displayName: town.displayName ?? null,
        municipalityId: town.municipalityId ?? null,
        postalCode: town.postalCode ?? null,
        priority: town.priority ?? null,
        cutOffPickupTime: town.cutOffPickupTime ?? null,
        active: true,
        raw: town.raw as Prisma.InputJsonValue,
        syncedAt: new Date(),
      },
    }),
  );
  if (seenIds.length) {
    await db.xExpressTown.updateMany({
      where: { id: { notIn: seenIds } },
      data: { active: false },
    });
  }
}

async function upsertStreets(streets: XExpressStreet[]) {
  const seenIds = streets.map((s) => s.id);
  await runChunked(streets, (street) =>
    db.xExpressStreet.upsert({
      where: { id: street.id },
      create: {
        id: street.id,
        streetId: street.streetId ?? null,
        name: street.name,
        simpleName: street.simpleName ?? null,
        townId: street.townId,
        official: street.official,
        deleted: street.deleted,
        active: !street.deleted,
        raw: street.raw as Prisma.InputJsonValue,
      },
      update: {
        streetId: street.streetId ?? null,
        name: street.name,
        simpleName: street.simpleName ?? null,
        townId: street.townId,
        official: street.official,
        deleted: street.deleted,
        active: !street.deleted,
        raw: street.raw as Prisma.InputJsonValue,
        syncedAt: new Date(),
      },
    }),
  );
  if (seenIds.length) {
    await db.xExpressStreet.updateMany({
      where: { id: { notIn: seenIds } },
      data: { active: false },
    });
  }
}

async function mirrorTownsToLegacyLocationCache(towns: XExpressTown[]) {
  const seenCodes = towns.map((town) => String(town.id));
  await runChunked(towns, (town) =>
    db.courierLocationCode.upsert({
      where: {
        provider_code: {
          provider: X_EXPRESS_PROVIDER,
          code: String(town.id),
        },
      },
      create: {
        provider: X_EXPRESS_PROVIDER,
        code: String(town.id),
        name: town.displayName ?? town.name,
        postalCode: town.postalCode ?? null,
        municipality: town.municipalityId ? String(town.municipalityId) : null,
        city: town.name,
        settlement: town.name,
        active: true,
        raw: town.raw as Prisma.InputJsonValue,
      },
      update: {
        name: town.displayName ?? town.name,
        postalCode: town.postalCode ?? null,
        municipality: town.municipalityId ? String(town.municipalityId) : null,
        city: town.name,
        settlement: town.name,
        active: true,
        raw: town.raw as Prisma.InputJsonValue,
        syncedAt: new Date(),
      },
    }),
  );
  if (seenCodes.length) {
    await db.courierLocationCode.updateMany({
      where: {
        provider: X_EXPRESS_PROVIDER,
        code: { notIn: seenCodes },
      },
      data: { active: false },
    });
  }
}

export async function syncXExpressStatuses(client = new XExpressClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "STATUSES" },
  });
  try {
    const statuses = await client.fetchStatusCodes();
    const seenCodes = statuses.map((s) => s.code);
    await runChunked(statuses, (status) => upsertStatusCode(status));
    if (seenCodes.length) {
      await db.courierStatusCode.updateMany({
        where: {
          provider: X_EXPRESS_PROVIDER,
          code: { notIn: seenCodes },
        },
        data: { active: false },
      });
    }
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        recordsRead: statuses.length,
        recordsOk: statuses.length,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, count: statuses.length };
  } catch (err) {
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Nepoznata greška.",
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

async function upsertStatusCode(status: XExpressStatusCode) {
  await db.courierStatusCode.upsert({
    where: {
      provider_code: {
        provider: X_EXPRESS_PROVIDER,
        code: status.code,
      },
    },
    create: {
      provider: X_EXPRESS_PROVIDER,
      code: status.code,
      label: status.label,
      shipmentStatus: status.shipmentStatus,
      orderStatus: status.orderStatus,
      active: true,
      raw: status.raw as Prisma.InputJsonValue,
    },
    update: {
      label: status.label,
      shipmentStatus: status.shipmentStatus,
      orderStatus: status.orderStatus,
      active: true,
      raw: status.raw as Prisma.InputJsonValue,
      syncedAt: new Date(),
    },
  });
}

export async function syncXExpressShipmentStatuses(limit = 100) {
  requireXExpressEnabled();
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "SHIPMENTS" },
  });
  let ok = 0;
  let fail = 0;

  try {
    const shipments = await db.shipment.findMany({
      where: {
        provider: X_EXPRESS_PROVIDER,
        service: "COURIER_SMALL",
        trackingNo: { not: null },
        status: { notIn: ["DELIVERED", "RETURNED", "FAILED"] },
      },
      orderBy: [{ lastStatusSyncAt: "asc" }, { updatedAt: "asc" }],
      take: Math.max(1, Math.min(limit, 500)),
      select: { id: true },
    });

    for (const shipment of shipments) {
      try {
        await syncXExpressShipmentById(shipment.id);
        ok += 1;
      } catch (err) {
        fail += 1;
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            syncError: err instanceof Error ? err.message : "Status sync nije uspeo.",
            lastStatusSyncAt: new Date(),
          },
        });
      }
    }

    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: fail ? (ok ? "PARTIAL" : "FAILED") : "SUCCESS",
        recordsRead: ok + fail,
        recordsOk: ok,
        recordsFail: fail,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, recordsRead: ok + fail, recordsOk: ok, recordsFail: fail };
  } catch (err) {
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        recordsRead: ok + fail,
        recordsOk: ok,
        recordsFail: fail,
        errorMessage: err instanceof Error ? err.message : "Nepoznata greška.",
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

export async function syncXExpressShipmentById(shipmentId: string) {
  const cfg = requireXExpressEnabled();
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, trackingNo: true, provider: true },
  });
  if (!shipment?.trackingNo || shipment.provider !== X_EXPRESS_PROVIDER) {
    throw new Error("X Express pošiljka nije pronađena.");
  }
  if (!cfg.paths.status) {
    await db.shipment.update({
      where: { id: shipment.id },
      data: {
        lastStatusSyncAt: new Date(),
        syncError:
          "X Express status se prima preko webhook-a; poseban status endpoint nije podešen.",
      },
    });
    return { events: 0, applied: 0, webhookOnly: true as const };
  }

  const events = await new XExpressClient(cfg).fetchTrackingEvents(shipment.trackingNo);
  const mapped = await applyDictionaryMappings(events);
  const results = [];

  for (const event of mapped) {
    const result = await applyShipmentEvent("COURIER_SMALL", {
      trackingNo: event.trackingNo,
      status: event.status,
      message: event.message ?? undefined,
      occurredAt: event.occurredAt,
      raw: event.raw,
      providerEventId: event.providerEventId ?? undefined,
      providerStatusCode: event.providerStatusCode,
    });
    if (result) {
      results.push(result);
      if (result.eventCreated) {
        await notifyShipmentSideEffects(result.orderId, result.status, result.customerEmail);
      }
    }
  }

  const latest = mapped.at(-1);
  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      providerStatusCode: latest?.providerStatusCode ?? undefined,
      lastStatusSyncAt: new Date(),
      syncError: null,
    },
  });

  return { events: mapped.length, applied: results.length };
}

async function applyDictionaryMappings(events: XExpressTrackingEvent[]) {
  const codes = [...new Set(events.map((event) => event.providerStatusCode))];
  const rows = await db.courierStatusCode.findMany({
    where: {
      provider: X_EXPRESS_PROVIDER,
      code: { in: codes },
      active: true,
    },
    select: { code: true, shipmentStatus: true },
  });
  const byCode = new Map<string, ShipmentStatus | null>(
    rows.map((row) => [row.code, row.shipmentStatus]),
  );
  return events.map((event) => ({
    ...event,
    status: byCode.get(event.providerStatusCode) ?? event.status,
  }));
}

async function notifyShipmentSideEffects(
  orderId: string,
  status: ShipmentStatus,
  customerEmail: string | null,
) {
  if (customerEmail) {
    try {
      const loaded = await loadOrderForEmail(orderId);
      if (loaded?.recipient) {
        await sendOrderStatusChanged({
          order: loaded.order,
          status: loaded.order.status,
          to: loaded.recipient,
        });
      }
    } catch (err) {
      console.error("[email] order-status (x-express sync) failed", err);
    }
  }

  if (status === "PICKED_UP") {
    void issueAndDeliverFiscalReceipt(orderId).catch((err) => {
      console.error("[fiscal] x-express sync trigger failed", err);
    });
  }
}
