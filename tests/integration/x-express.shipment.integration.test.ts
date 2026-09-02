// Acceptance: LOG-03
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createXExpressShipmentForOrder } from "@/lib/x-express/shipments";
import { postPickupBatches } from "@/lib/admin/pickup-batch.server";
import {
  processXExpressWebhookNotifyIds,
  stageXExpressWebhookBatch,
} from "@/lib/x-express/webhook";

const runId = `${Date.now()}-${process.pid}`;
const orderNumber = `XE-IT-${runId}`;
const productSku = `XE-IT-${runId}`.slice(0, 90);
const requestGuid = "758bb513-499d-4ab1-8697-5e747602f222";
const webhookReferenceGuid = "4c4d7389-bf92-4c39-8cd8-91014c410a18";
const notifyId = randomUUID();
const cancelledNotifyId = randomUUID();
const pickupNotifyId = randomUUID();

let server: Server;
let baseUrl = "";
let orderId = "";
let productId = "";
let batchId = "";
const requests: Array<{
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      requests.push({ url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/order/check-address") {
        res.statusCode = 200;
        res.end(JSON.stringify({ area: "SA-GR-01" }));
        return;
      }
      if (req.url === "/api/order/add") {
        res.statusCode = 202;
        res.end(JSON.stringify({ requestGuid }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server failed.");
  baseUrl = `http://127.0.0.1:${address.port}`;

  Object.assign(process.env, {
    X_EXPRESS_ENABLED: "true",
    X_EXPRESS_ENV: "test",
    X_EXPRESS_BASE_URL: baseUrl,
    X_EXPRESS_API_USER: "integration-user",
    X_EXPRESS_API_KEY: "integration-key",
    X_EXPRESS_CONTRACT_CODE: "U000328",
    X_EXPRESS_CODE_PREFIX: "QAX",
    X_EXPRESS_CODE_RANGE_START: "850300001",
    X_EXPRESS_CODE_RANGE_END: "850599999",
    X_EXPRESS_CHECK_ADDRESS_PATH: "/api/order/check-address",
    X_EXPRESS_CREATE_ORDER_PATH: "/api/order/add",
    X_EXPRESS_PICKUP_NAME: "QA DC",
    X_EXPRESS_PICKUP_TOWN_ID: "746606",
    X_EXPRESS_PICKUP_STREET_NAME: "Severna transferzala",
    X_EXPRESS_PICKUP_STREET_NUMBER: "bb",
    X_EXPRESS_PICKUP_LATITUDE: "44.7735236",
    X_EXPRESS_PICKUP_LONGITUDE: "19.6805083",
    X_EXPRESS_PICKUP_DESCRIPTION: "Izolovani integracioni test",
    X_EXPRESS_PICKUP_CONTACT_NAME: "QA DC",
    X_EXPRESS_PICKUP_CONTACT_PHONE: "381641234567",
    X_EXPRESS_PICKUP_CONTACT_EMAIL: "qa@example.invalid",
    X_EXPRESS_WEBHOOK_API_KEY: "integration-webhook-key",
    COURIER_SMALL_PROVIDER: "X_EXPRESS",
  });

  await db.xExpressTown.upsert({
    where: { id: 746606 },
    create: {
      id: 746606,
      name: "Šabac",
      displayName: "Šabac (Šabac) - 15000",
      postalCode: "15000",
      active: true,
    },
    update: { active: true },
  });
  await db.xExpressStreet.upsert({
    where: { id: 38975 },
    create: {
      id: 38975,
      streetId: 142489,
      name: "Severna transferzala",
      simpleName: "severna transferzala",
      townId: 746606,
      official: true,
      deleted: false,
      active: true,
    },
    update: { active: true, deleted: false },
  });
  const product = await db.product.create({
    data: {
      sku: productSku,
      slug: `xe-it-${runId}`,
      name: "Integracioni paket",
      description: "X Express izolovani integracioni test",
      fullPrice: 1_000,
      packQty: 2,
      packGrossWeightKg: 3,
      packWidthCm: 50,
      packDepthCm: 40,
      packHeightCm: 30,
    },
    select: { id: true },
  });
  productId = product.id;
  const order = await db.order.create({
    data: {
      number: orderNumber,
      status: "U_PRIPREMI",
      channel: "WEB",
      subtotal: 4_000,
      total: 4_000,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      shipFirstName: "QA",
      shipLastName: "Primalac",
      shipPhone: "+381 64 222 33 44",
      shipStreet: "Severna transverzala bb",
      shipCity: "Šabac",
      shipPostalCode: "15000",
      shipXExpressTownId: 746606,
      shipXExpressStreetId: 38975,
      notes: "Pozvati primaoca pre isporuke, ulaz iz dvorišta.",
      termsAcceptedAt: new Date(),
      items: {
        create: {
          productId,
          sku: productSku,
          name: "Integracioni paket",
          qty: 4,
          unitPriceFull: 1_000,
          unitPriceSale: 1_000,
        },
      },
    },
    select: { id: true },
  });
  orderId = order.id;
});

afterAll(async () => {
  await db.xExpressWebhookEvent.deleteMany({
    where: {
      notifyId: { in: [notifyId, cancelledNotifyId, pickupNotifyId] },
    },
  });
  await db.backgroundJob.deleteMany({
    where: {
      OR: [
        { idempotencyKey: `fiscal-pickup:${orderId}` },
        { idempotencyKey: `order-status-email:${orderId}:PICKED_UP` },
      ],
    },
  });
  if (batchId) await db.pickupBatch.deleteMany({ where: { id: batchId } });
  if (orderId) await db.order.deleteMany({ where: { id: orderId } });
  if (productId) await db.product.deleteMany({ where: { id: productId } });
  await db.courierCodeSequence.deleteMany({ where: { provider: "X_EXPRESS" } });
  await db.xExpressStreet.deleteMany({ where: { id: 38975 } });
  await db.xExpressTown.deleteMany({ where: { id: 746606 } });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("X Express shipment persistence", () => {
  it("creates labels and announces in one action, keeps unique package data and resolves its webhook reference", async () => {
    const item = await db.orderItem.findFirstOrThrow({
      where: { orderId },
      select: { id: true },
    });
    const batch = await db.pickupBatch.create({
      data: {
        number: `XE-PRE-${runId}`,
        courier: "COURIER_SMALL",
        provider: "X_EXPRESS",
        pickupDate: new Date("2099-07-27T10:00:00Z"),
        pickupWindowEnd: new Date("2099-07-27T12:00:00Z"),
        lines: {
          create: [1, 2].map((packageNo) => ({
            orderId,
            orderItemId: item.id,
            lineGroupKey: `order:${orderId}:X_EXPRESS`,
            packageNo,
            weightKg: 3,
            widthCm: 50,
            depthCm: 40,
            heightCm: 30,
          })),
        },
      },
    });
    batchId = batch.id;
    await expect(postPickupBatches([batch.id], "integration-test")).resolves.toEqual({
      posted: 1,
      shipmentCount: 1,
      labelsPrepared: 0,
      announced: 1,
    });
    const shipment = await db.shipment.findFirstOrThrow({
      where: { orderId, provider: "X_EXPRESS" },
    });
    const postedBatch = await db.pickupBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    expect(postedBatch.status).toBe("BOOKED");
    expect(postedBatch.labelsCreatedAt).not.toBeNull();
    expect(postedBatch.manifestRef).toBe(`XEXPRESS:${batch.number}`);
    expect(postedBatch.configurationIssue).toBeNull();
    expect(shipment.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(shipment.provider).toBe("X_EXPRESS");
    expect(shipment.providerShipmentId).toBe(requestGuid);
    expect(shipment.providerRouteCode).toBe("SA-GR-01");
    expect(shipment.packageCount).toBe(2);
    expect(shipment.trackingNo).toBe("QAX0850300001");
    expect(shipment.providerParcelNumbers).toEqual([
      "QAX0850300001",
      "QAX0850300002",
    ]);
    expect(requests.filter((request) => request.url === "/api/order/add")).toHaveLength(1);

    const checkRequest = requests.find(
      (request) => request.url === "/api/order/check-address",
    );
    const addRequest = requests.find((request) => request.url === "/api/order/add");
    expect(checkRequest?.body).toEqual({
      Name: "QA Primalac",
      TownId: 746606,
      StreetName: "Severna transferzala",
      StreetNumber: "bb",
      Description: null,
    });
    expect(addRequest?.headers["x-api-user"]).toBe("integration-user");
    expect(addRequest?.headers["x-api-key"]).toBe("integration-key");
    expect(addRequest?.body.Reference).toBe(shipment.id);
    const deliveryWaypoint = (
      (addRequest?.body.Waypoints ?? []) as Array<{
        WaypointType: string;
        Address: { Description: string };
      }>
    ).find((waypoint) => waypoint.WaypointType === "DELIVERY");
    expect(deliveryWaypoint?.Address.Description).toBe(
      "Isporuka webshop porudžbine",
    );
    expect(JSON.stringify(addRequest?.body)).not.toContain("Pozvati primaoca");
    expect(addRequest?.body.Packages).toEqual([
      { Code: "QAX0850300001", Mass: 3, Content: "Integracioni paket" },
      { Code: "QAX0850300002", Mass: 3, Content: "Integracioni paket" },
    ]);

    const duplicate = await createXExpressShipmentForOrder(orderId, {
      packageCount: 2,
    });
    expect(duplicate.id).toBe(shipment.id);
    expect(requests.filter((request) => request.url === "/api/order/add")).toHaveLength(1);

    await stageXExpressWebhookBatch([
      {
        ContractId: "U000328",
        NotifyId: notifyId,
        OrderCode: "XE-ORDER-1",
        ReferenceId: shipment.id,
        ReferenceGuid: webhookReferenceGuid,
        Status: "CREATED",
        StatusTime: "2026-07-26T12:00:00Z",
      },
    ]);
    await expect(processXExpressWebhookNotifyIds([notifyId])).resolves.toEqual({
      read: 1,
      processed: 1,
      failed: 0,
    });
    const persisted = await db.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(persisted.providerOrderId).toBe("XE-ORDER-1");
    expect(persisted.providerShipmentId).toBe(webhookReferenceGuid);
    expect(persisted.providerStatusCode).toBe("CREATED");
    const webhook = await db.xExpressWebhookEvent.findUniqueOrThrow({
      where: { notifyId },
    });
    expect(webhook.orderId).toBe(orderId);
    expect(webhook.shipmentId).toBe(shipment.id);
    expect(webhook.processedAt).not.toBeNull();

    await stageXExpressWebhookBatch([
      {
        ContractId: "U000328",
        NotifyId: cancelledNotifyId,
        OrderCode: "XE-ORDER-1",
        ReferenceId: shipment.id,
        ReferenceGuid: webhookReferenceGuid,
        Status: "SRVC_CANCELED",
        StatusTime: "2099-07-26T12:30:00Z",
      },
    ]);
    await expect(
      processXExpressWebhookNotifyIds([cancelledNotifyId]),
    ).resolves.toEqual({ read: 1, processed: 1, failed: 0 });
    await expect(
      db.pickupBatchLine.count({
        where: { batchId: batch.id, courierPickedUpAt: { not: null } },
      }),
    ).resolves.toBe(0);
    await expect(
      db.pickupBatch.findUniqueOrThrow({
        where: { id: batch.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "BOOKED" });

    await stageXExpressWebhookBatch([
      {
        ContractId: "U000328",
        NotifyId: pickupNotifyId,
        OrderCode: "XE-ORDER-1",
        ReferenceId: shipment.id,
        ReferenceGuid: webhookReferenceGuid,
        Status: "PICKED_UP",
        StatusTime: "2099-07-26T13:00:00Z",
      },
    ]);
    await expect(processXExpressWebhookNotifyIds([pickupNotifyId])).resolves.toEqual({
      read: 1,
      processed: 1,
      failed: 0,
    });

    const handedOverShipment = await db.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      select: { status: true, shippedAt: true, providerStatusCode: true },
    });
    expect(handedOverShipment).toMatchObject({
      status: "PICKED_UP",
      providerStatusCode: "PICKED_UP",
    });
    expect(handedOverShipment.shippedAt).not.toBeNull();
    await expect(
      db.backgroundJob.findUniqueOrThrow({
        where: { idempotencyKey: `fiscal-pickup:${orderId}` },
        select: { kind: true, status: true, payload: true },
      }),
    ).resolves.toMatchObject({
      kind: "FISCAL_RECEIPT",
      status: "QUEUED",
      payload: { orderId },
    });
    await expect(
      db.pickupBatchLine.count({
        where: { batchId: batch.id, courierPickedUpAt: { not: null } },
      }),
    ).resolves.toBe(2);
    await expect(
      db.pickupBatch.findUniqueOrThrow({
        where: { id: batch.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PICKED_UP" });

    await expect(processXExpressWebhookNotifyIds([pickupNotifyId])).resolves.toEqual({
      read: 0,
      processed: 0,
      failed: 0,
    });
    await expect(
      db.shipmentEvent.count({
        where: { shipmentId: shipment.id, providerEventId: pickupNotifyId },
      }),
    ).resolves.toBe(1);
  });
});
