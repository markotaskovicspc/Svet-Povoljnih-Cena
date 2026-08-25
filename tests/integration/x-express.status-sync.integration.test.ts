import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  syncXExpressShipmentById,
  syncXExpressShipmentStatuses,
} from "@/lib/x-express/sync";

const runId = `${Date.now()}-${process.pid}`;
const orderNumber = `XE-STATUS-IT-${runId}`;
const shipmentId = randomUUID();
const syncRunIds: string[] = [];
let orderId = "";

beforeAll(async () => {
  Object.assign(process.env, {
    X_EXPRESS_ENABLED: "true",
    X_EXPRESS_ENV: "test",
    X_EXPRESS_BASE_URL: "https://example.invalid",
    X_EXPRESS_API_USER: "integration-user",
    X_EXPRESS_API_KEY: "integration-key",
    X_EXPRESS_CONTRACT_CODE: "U000328",
    X_EXPRESS_STATUS_PATH: "",
    COURIER_SMALL_PROVIDER: "X_EXPRESS",
  });

  const order = await db.order.create({
    data: {
      number: orderNumber,
      status: "U_PRIPREMI",
      channel: "WEB",
      subtotal: 0,
      total: 0,
      shippingMethod: "KURIR",
      paymentMethod: "UPLATA_NA_RACUN",
      shipFirstName: "Codex",
      shipLastName: "Status QA",
      shipPhone: "0600000000",
      shipStreet: "Webhook-only 1",
      shipCity: "Beograd",
      shipPostalCode: "11000",
      termsAcceptedAt: new Date(),
      shipments: {
        create: {
          id: shipmentId,
          service: "COURIER_SMALL",
          provider: "X_EXPRESS",
          trackingNo: "AAA0850300001",
          status: "CREATED",
        },
      },
    },
    select: { id: true },
  });
  orderId = order.id;
});

afterAll(async () => {
  if (syncRunIds.length) {
    await db.courierSyncRun.deleteMany({ where: { id: { in: syncRunIds } } });
  }
  if (orderId) {
    const target = await db.order.findUnique({
      where: { id: orderId },
      select: { number: true },
    });
    if (!target?.number.startsWith("XE-STATUS-IT-")) {
      throw new Error("X Express status integration cleanup guard failed.");
    }
    await db.order.delete({ where: { id: orderId } });
  }
});

describe("X Express webhook-only status synchronization", () => {
  it("records a successful no-network sync when no polling endpoint is configured", async () => {
    await expect(syncXExpressShipmentById(shipmentId)).resolves.toEqual({
      events: 0,
      applied: 0,
      webhookOnly: true,
    });

    const direct = await db.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { lastStatusSyncAt: true, syncError: true, status: true },
    });
    expect(direct.lastStatusSyncAt).not.toBeNull();
    expect(direct.syncError).toContain("status se prima preko webhook-a");
    expect(direct.status).toBe("CREATED");

    const beforeRun = new Date();
    await expect(syncXExpressShipmentStatuses(1)).resolves.toEqual({
      ok: true,
      recordsRead: 1,
      recordsOk: 1,
      recordsFail: 0,
    });
    const run = await db.courierSyncRun.findFirstOrThrow({
      where: {
        provider: "X_EXPRESS",
        kind: "SHIPMENTS",
        startedAt: { gte: beforeRun },
      },
      orderBy: { startedAt: "desc" },
    });
    syncRunIds.push(run.id);
    expect(run).toMatchObject({
      status: "SUCCESS",
      recordsRead: 1,
      recordsOk: 1,
      recordsFail: 0,
      errorMessage: null,
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it("does not poll terminal shipments", async () => {
    await db.shipment.update({
      where: { id: shipmentId },
      data: { status: "DELIVERED" },
    });
    const beforeRun = new Date();
    await expect(syncXExpressShipmentStatuses(1)).resolves.toEqual({
      ok: true,
      recordsRead: 0,
      recordsOk: 0,
      recordsFail: 0,
    });
    const run = await db.courierSyncRun.findFirstOrThrow({
      where: {
        provider: "X_EXPRESS",
        kind: "SHIPMENTS",
        startedAt: { gte: beforeRun },
      },
      orderBy: { startedAt: "desc" },
    });
    syncRunIds.push(run.id);
    expect(run.status).toBe("SUCCESS");
  });
});
