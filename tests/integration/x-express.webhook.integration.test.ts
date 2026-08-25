// Acceptance: LOG-03 webhook contract, idempotency and ordering
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/x-express/webhook/route";
import { processXExpressWebhookNotifyIds } from "@/lib/x-express/webhook";

const runId = `${Date.now()}-${process.pid}`;
const orderNumber = `XE-WH-IT-${runId}`;
const shipmentId = randomUUID();
const trackingNo = `XEWH${String(Date.now()).slice(-9)}`;
const notifyIds: string[] = [];
let orderId = "";

function webhookEvent(status: string, statusTime: Date) {
  const notifyId = randomUUID();
  notifyIds.push(notifyId);
  return {
    ContractId: "U000328",
    NotifyId: notifyId,
    OrderCode: `XE-ORDER-${runId}`,
    ReferenceId: shipmentId,
    ReferenceGuid: randomUUID(),
    Status: status,
    StatusTime: statusTime.toISOString(),
  };
}

function webhookRequest(
  body: unknown,
  headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-sender": "XExpress",
    "x-api-key": "integration-webhook-key",
  },
) {
  return new Request("https://example.invalid/api/x-express/webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  Object.assign(process.env, {
    X_EXPRESS_WEBHOOK_API_KEY: "integration-webhook-key",
    X_EXPRESS_CONTRACT_CODE: "U000328",
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
      shipLastName: "X Express QA",
      shipPhone: "0600000000",
      shipStreet: "QA webhook 1",
      shipCity: "Beograd",
      shipPostalCode: "11000",
      termsAcceptedAt: new Date(),
      shipments: {
        create: {
          id: shipmentId,
          service: "COURIER_SMALL",
          provider: "X_EXPRESS",
          trackingNo,
          packageCount: 1,
          status: "CREATED",
        },
      },
    },
    select: { id: true },
  });
  orderId = order.id;
});

afterAll(async () => {
  await db.xExpressWebhookEvent.deleteMany({
    where: { notifyId: { in: notifyIds } },
  });
  if (orderId) {
    const target = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true },
    });
    if (!target || target.number !== orderNumber || !target.number.startsWith("XE-WH-IT-")) {
      throw new Error("X Express webhook integration cleanup guard failed.");
    }
    await db.order.delete({ where: { id: target.id } });
  }
});

describe("X Express webhook persistence", () => {
  it("rejects missing auth, bad sender, invalid JSON and the wrong contract", async () => {
    const unauthenticated = await POST(webhookRequest([], { "content-type": "application/json" }));
    expect(unauthenticated.status).toBe(401);

    const badSender = await POST(
      webhookRequest([], {
        "content-type": "application/json",
        "x-api-sender": "NotXExpress",
        "x-api-key": "integration-webhook-key",
      }),
    );
    expect(badSender.status).toBe(401);

    const invalidJson = await POST(webhookRequest("{"));
    expect(invalidJson.status).toBe(400);

    const wrongContractId = randomUUID();
    notifyIds.push(wrongContractId);
    const wrongContract = await POST(
      webhookRequest({
        ContractId: "U999999",
        NotifyId: wrongContractId,
        ReferenceId: shipmentId,
        Status: "REQUEST_RECEIVED",
        StatusTime: new Date().toISOString(),
      }),
    );
    expect(wrongContract.status).toBe(400);
    expect(
      await db.xExpressWebhookEvent.count({ where: { notifyId: wrongContractId } }),
    ).toBe(0);
  });

  it("stages a reversed batch quickly and deduplicates provider retries", async () => {
    const base = new Date("2026-08-25T08:00:00.000Z");
    const created = webhookEvent("REQUEST_RECEIVED", base);
    const outForDelivery = webhookEvent(
      "DLV_ASSIGNED",
      new Date(base.getTime() + 60_000),
    );
    const delivered = webhookEvent(
      "DELIVERED",
      new Date(base.getTime() + 120_000),
    );
    const reversed = [delivered, outForDelivery, created];

    const first = await POST(webhookRequest({ notifications: reversed }));
    const duplicate = await POST(webhookRequest({ notifications: reversed }));
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("");
    expect(duplicate.status).toBe(200);
    expect(await duplicate.text()).toBe("");

    const staged = await db.xExpressWebhookEvent.findMany({
      where: {
        notifyId: { in: [created.NotifyId, outForDelivery.NotifyId, delivered.NotifyId] },
      },
      orderBy: { statusTime: "asc" },
      select: { statusCode: true, processedAt: true },
    });
    expect(staged).toEqual([
      { statusCode: "REQUEST_RECEIVED", processedAt: null },
      { statusCode: "DLV_ASSIGNED", processedAt: null },
      { statusCode: "DELIVERED", processedAt: null },
    ]);

    await expect(
      processXExpressWebhookNotifyIds([
        delivered.NotifyId,
        outForDelivery.NotifyId,
        created.NotifyId,
      ]),
    ).resolves.toEqual({ read: 3, processed: 3, failed: 0 });

    const shipment = await db.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: {
        status: true,
        providerStatusCode: true,
        deliveredAt: true,
        events: { orderBy: { occurredAt: "asc" }, select: { status: true } },
        order: { select: { status: true } },
      },
    });
    expect(shipment).toMatchObject({
      status: "DELIVERED",
      providerStatusCode: "DELIVERED",
      order: { status: "ISPORUCENO" },
      events: [
        { status: "CREATED" },
        { status: "OUT_FOR_DELIVERY" },
        { status: "DELIVERED" },
      ],
    });
    expect(shipment.deliveredAt).not.toBeNull();
  });

  it.fails("does not regress a delivered shipment when an older event arrives late", async () => {
    const lateOlder = webhookEvent(
      "REQUEST_RECEIVED",
      new Date("2026-08-25T07:59:00.000Z"),
    );
    const response = await POST(
      webhookRequest(lateOlder, {
        "content-type": "application/json",
        "x-api-sender": "XExpress",
        authorization: "Bearer integration-webhook-key",
      }),
    );
    expect(response.status).toBe(200);
    await expect(processXExpressWebhookNotifyIds([lateOlder.NotifyId])).resolves.toEqual({
      read: 1,
      processed: 1,
      failed: 0,
    });

    const shipment = await db.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { status: true, order: { select: { status: true } } },
    });
    expect(shipment).toEqual({
      status: "DELIVERED",
      order: { status: "ISPORUCENO" },
    });
  });

  it("fails closed on an unknown provider status", async () => {
    const unknown = webhookEvent(
      "TOTALLY_UNKNOWN_QA_STATUS",
      new Date("2026-08-25T09:00:00.000Z"),
    );
    expect((await POST(webhookRequest(unknown))).status).toBe(200);
    await expect(processXExpressWebhookNotifyIds([unknown.NotifyId])).resolves.toEqual({
      read: 1,
      processed: 1,
      failed: 0,
    });

    const shipment = await db.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { status: true },
    });
    expect(shipment.status).toBe("FAILED");
  });
});
