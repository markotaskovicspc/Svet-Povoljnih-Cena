import "server-only";

import { Prisma, type ShipmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { applyShipmentEvent } from "@/lib/courier/registry";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";
import { XExpressClient } from "./client";
import { X_EXPRESS_PROVIDER, requireXExpressEnabled } from "./config";
import type { XExpressStatusCode, XExpressTrackingEvent } from "./types";

export async function syncXExpressDictionaries() {
  const cfg = requireXExpressEnabled();
  const client = new XExpressClient(cfg);
  const [locations, statuses] = await Promise.all([
    syncXExpressLocations(client),
    syncXExpressStatuses(client),
  ]);
  return { locations, statuses };
}

export async function syncXExpressLocations(client = new XExpressClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "LOCATIONS" },
  });
  try {
    const locations = await client.fetchLocationCodes();
    const seenCodes = locations.map((l) => l.code);
    for (const location of locations) {
      await db.courierLocationCode.upsert({
        where: {
          provider_code: {
            provider: X_EXPRESS_PROVIDER,
            code: location.code,
          },
        },
        create: {
          provider: X_EXPRESS_PROVIDER,
          code: location.code,
          name: location.name,
          postalCode: location.postalCode ?? null,
          municipality: location.municipality ?? null,
          city: location.city ?? null,
          settlement: location.settlement ?? null,
          active: true,
          raw: location.raw as Prisma.InputJsonValue,
        },
        update: {
          name: location.name,
          postalCode: location.postalCode ?? null,
          municipality: location.municipality ?? null,
          city: location.city ?? null,
          settlement: location.settlement ?? null,
          active: true,
          raw: location.raw as Prisma.InputJsonValue,
          syncedAt: new Date(),
        },
      });
    }
    if (seenCodes.length) {
      await db.courierLocationCode.updateMany({
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
        recordsRead: locations.length,
        recordsOk: locations.length,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, count: locations.length };
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

export async function syncXExpressStatuses(client = new XExpressClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: X_EXPRESS_PROVIDER, kind: "STATUSES" },
  });
  try {
    const statuses = await client.fetchStatusCodes();
    const seenCodes = statuses.map((s) => s.code);
    for (const status of statuses) {
      await upsertStatusCode(status);
    }
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
