import "server-only";

import { Prisma, type ShipmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { applyShipmentEvent } from "@/lib/courier/registry";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";
import { MyGlsClient, decompressMyGlsJson } from "./client";
import { MYGLS_PROVIDER, requireMyGlsEnabled } from "./config";
import { orderStatusForMyGlsStatus, inferMyGlsShipmentStatus } from "./status";
import { parcelNumberList } from "./shipments";
import type {
  MyGlsDeliveryPoint,
  MyGlsLocation,
  MyGlsParcelListStatusesResponse,
  MyGlsParcelStatusResponse,
  MyGlsStatusEvent,
} from "./types";

export async function syncMyGlsMasterData() {
  requireMyGlsEnabled();
  const client = new MyGlsClient();
  const [deliveryPoints, locations] = await Promise.all([
    syncMyGlsDeliveryPoints(client),
    syncMyGlsLocations(client),
  ]);
  return { deliveryPoints, locations };
}

export async function syncMyGlsDeliveryPoints(client = new MyGlsClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: MYGLS_PROVIDER, kind: "LOCATIONS" },
  });
  try {
    const cursor = await readCursor("DELIVERY_POINTS");
    const response = await client.getDeliveryPoints(cursor?.lastSyncedAt ?? null);
    const changed = response.IsChanged !== false;
    const items = changed ? decompressMyGlsJson<MyGlsDeliveryPoint>(response.Data) : [];
    const seenCodes: string[] = [];
    for (const point of items) {
      const row = deliveryPointRow(point);
      if (!row.code || !row.name) continue;
      seenCodes.push(row.code);
      await db.courierDeliveryPoint.upsert({
        where: { provider_code: { provider: MYGLS_PROVIDER, code: row.code } },
        create: { provider: MYGLS_PROVIDER, ...row, active: true },
        update: { ...row, active: true, syncedAt: new Date() },
      });
    }
    if (seenCodes.length) {
      await db.courierDeliveryPoint.updateMany({
        where: { provider: MYGLS_PROVIDER, code: { notIn: seenCodes } },
        data: { active: false },
      });
    }
    await writeCursor("DELIVERY_POINTS", response.LastUpdateTime, response);
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        recordsRead: items.length,
        recordsOk: items.length,
        raw: response as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, changed, count: items.length };
  } catch (err) {
    await markRunFailed(run.id, err);
    throw err;
  }
}

export async function syncMyGlsLocations(client = new MyGlsClient()) {
  const run = await db.courierSyncRun.create({
    data: { provider: MYGLS_PROVIDER, kind: "LOCATIONS" },
  });
  try {
    const cursor = await readCursor("LOCATIONS");
    const response = await client.getLocations(cursor?.lastSyncedAt ?? null);
    const changed = response.IsChanged !== false;
    const items = changed ? decompressMyGlsJson<MyGlsLocation>(response.Data) : [];
    const seenCodes: string[] = [];
    for (const item of items) {
      const code = String(item.Id ?? item.ZipCode ?? item.Name ?? "").trim();
      const name = String(item.Name ?? item.City ?? code).trim();
      if (!code || !name) continue;
      seenCodes.push(code);
      await db.courierLocationCode.upsert({
        where: { provider_code: { provider: MYGLS_PROVIDER, code } },
        create: {
          provider: MYGLS_PROVIDER,
          code,
          name,
          postalCode: stringOrNull(item.ZipCode),
          city: stringOrNull(item.City ?? item.Name),
          active: true,
          raw: item as Prisma.InputJsonValue,
        },
        update: {
          name,
          postalCode: stringOrNull(item.ZipCode),
          city: stringOrNull(item.City ?? item.Name),
          active: true,
          raw: item as Prisma.InputJsonValue,
          syncedAt: new Date(),
        },
      });
    }
    if (seenCodes.length) {
      await db.courierLocationCode.updateMany({
        where: { provider: MYGLS_PROVIDER, code: { notIn: seenCodes } },
        data: { active: false },
      });
    }
    await writeCursor("LOCATIONS", response.LastUpdateTime, response);
    await db.courierSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        recordsRead: items.length,
        recordsOk: items.length,
        raw: response as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return { ok: true as const, changed, count: items.length };
  } catch (err) {
    await markRunFailed(run.id, err);
    throw err;
  }
}

export async function syncMyGlsShipmentStatuses(limit = 100) {
  requireMyGlsEnabled();
  const run = await db.courierSyncRun.create({
    data: { provider: MYGLS_PROVIDER, kind: "SHIPMENTS" },
  });
  let ok = 0;
  let fail = 0;

  try {
    const shipments = await db.shipment.findMany({
      where: {
        provider: MYGLS_PROVIDER,
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
        await syncMyGlsShipmentById(shipment.id);
        ok += 1;
      } catch (err) {
        fail += 1;
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            syncError: err instanceof Error ? err.message : "MyGLS status sync nije uspeo.",
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

export async function syncMyGlsShipmentById(shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      trackingNo: true,
      provider: true,
      providerParcelNumbers: true,
    },
  });
  if (!shipment?.trackingNo || shipment.provider !== MYGLS_PROVIDER) {
    throw new Error("MyGLS pošiljka nije pronađena.");
  }

  const numbers = parcelNumberList(shipment);
  if (!numbers.length) throw new Error("MyGLS parcel number nije sačuvan.");

  const client = new MyGlsClient();
  const raw =
    numbers.length > 1
      ? await client.getParcelListStatuses({ parcelNumberList: numbers })
      : await client.getParcelStatuses({ parcelNumber: numbers[0]! });
  const events = normalizeStatusResponses(raw, numbers);
  const results = [];

  for (const event of events) {
    const result = await applyShipmentEvent("COURIER_SMALL", {
      trackingNo: event.trackingNo,
      status: event.status,
      message: event.message ?? undefined,
      occurredAt: event.occurredAt,
      raw: event.raw,
      providerEventId: event.providerEventId,
      providerStatusCode: event.providerStatusCode,
    });
    if (result) {
      results.push(result);
      if (result.eventCreated) {
        await notifyShipmentSideEffects(result.orderId, result.status, result.customerEmail);
      }
    }
  }

  const latest = events.at(-1);
  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      providerStatusCode: latest?.providerStatusCode ?? undefined,
      lastStatusSyncAt: new Date(),
      syncError: null,
    },
  });

  return { events: events.length, applied: results.length };
}

function normalizeStatusResponses(
  response: MyGlsParcelStatusResponse | MyGlsParcelListStatusesResponse,
  fallbackNumbers: number[],
): MyGlsStatusEvent[] {
  if ("ParcelList" in response && Array.isArray(response.ParcelList)) {
    return response.ParcelList.flatMap((parcel) =>
      statusListToEvents(
        parcel.ParcelStatusList ?? [],
        parcel.ParcelNumber ?? fallbackNumbers[0]!,
        parcel.ClientReference,
      ),
    );
  }
  const single = response as MyGlsParcelStatusResponse;
  return statusListToEvents(
    single.ParcelStatusList ?? [],
    single.ParcelNumber ?? fallbackNumbers[0]!,
    single.ClientReference,
  );
}

function statusListToEvents(
  list: MyGlsParcelStatusResponse["ParcelStatusList"],
  parcelNumber: number,
  clientReference?: string | null,
): MyGlsStatusEvent[] {
  return (list ?? []).map((status) => {
    const code = String(status.StatusCode ?? "");
    const mapped = inferMyGlsShipmentStatus(code, status.StatusDescription ?? status.StatusInfo ?? null);
    const occurredAt = parseDate(status.StatusDate);
    return {
      trackingNo: String(parcelNumber),
      parcelNumber,
      providerStatusCode: code,
      status: mapped,
      orderStatus: orderStatusForMyGlsStatus(mapped),
      message: status.StatusDescription ?? status.StatusInfo ?? null,
      occurredAt,
      providerEventId: `MYGLS:${parcelNumber}:${code}:${occurredAt?.toISOString() ?? "unknown"}`,
      raw: { ...status, clientReference },
    };
  });
}

function deliveryPointRow(point: MyGlsDeliveryPoint) {
  const address = point.Address ?? {};
  const code = String(point.Matchcode ?? point.LegacyId ?? point.Id ?? "").trim();
  const name = String(address.Name ?? point.Matchcode ?? code).trim();
  return {
    code,
    name,
    type: point.DeliveryPointType == null ? null : String(point.DeliveryPointType),
    street: stringOrNull(address.Street),
    city: stringOrNull(address.City),
    postalCode: stringOrNull(address.ZipCode),
    country: stringOrNull(address.CountryIsoCode) ?? "RS",
    contactName: stringOrNull(address.ContactName),
    contactPhone: stringOrNull(address.ContactPhone),
    contactEmail: stringOrNull(address.ContactEmail),
    latitude: decimalOrNull(point.Latitude),
    longitude: decimalOrNull(point.Longitude),
    raw: point as Prisma.InputJsonValue,
  };
}

function decimalOrNull(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? new Prisma.Decimal(n) : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const dotNet = value.match(/\/Date\((\d+)\)\//);
  const date = dotNet ? new Date(Number(dotNet[1])) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function readCursor(kind: string) {
  return db.courierMasterDataCursor.findUnique({
    where: { provider_kind: { provider: MYGLS_PROVIDER, kind } },
  });
}

async function writeCursor(kind: string, lastUpdateTime: string | undefined, raw: unknown) {
  const parsed = lastUpdateTime ? new Date(lastUpdateTime) : new Date();
  await db.courierMasterDataCursor.upsert({
    where: { provider_kind: { provider: MYGLS_PROVIDER, kind } },
    create: {
      provider: MYGLS_PROVIDER,
      kind,
      lastSyncedAt: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
      raw: raw as Prisma.InputJsonValue,
    },
    update: {
      lastSyncedAt: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
      raw: raw as Prisma.InputJsonValue,
    },
  });
}

async function markRunFailed(runId: string, err: unknown) {
  await db.courierSyncRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : "Nepoznata greška.",
      finishedAt: new Date(),
    },
  });
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
      console.error("[email] order-status (mygls sync) failed", err);
    }
  }

  if (status === "PICKED_UP") {
    void issueAndDeliverFiscalReceipt(orderId).catch((err) => {
      console.error("[fiscal] mygls sync trigger failed", err);
    });
  }
}
