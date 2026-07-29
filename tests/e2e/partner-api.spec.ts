// Acceptance: PARTNER-01
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

test.describe("PARTNER-01 — lager i idempotentne rezervacije", () => {
  test.skip(
    process.env.E2E_PARTNER_API !== "1",
    "Set E2E_PARTNER_API=1 to run the isolated partner API acceptance.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const sku = `QA-PARTNER-${runId}`.slice(0, 80);
  const token = `spc_full_${runId}_partner_access_token`;
  const readToken = `spc_read_${runId}_partner_access_token`;
  const idempotencyKey = `qa-partner-reservation-${runId}`;
  let db: PrismaClient;
  let productId = "";
  let warehouseId = "";
  let fullClientId = "";
  let readClientId = "";
  let originalDefaultWarehouseIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    originalDefaultWarehouseIds = (
      await db.warehouse.findMany({
        where: { isDefault: true },
        select: { id: true },
      })
    ).map(({ id }) => id);
    await db.warehouse.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    const warehouse = await db.warehouse.create({
      data: {
        code: `QAP${runId}`.slice(0, 30),
        name: `QA partner DC ${runId}`,
        isDefault: true,
        active: true,
      },
      select: { id: true },
    });
    warehouseId = warehouse.id;
    const product = await db.product.create({
      data: {
        sku,
        slug: `qa-partner-${runId}`,
        name: `QA partner artikal ${runId}`,
        description: "Sintetički artikal za izolovani partner API test.",
        articleStatus: "SP",
        fullPrice: 1_000,
        cogs: 600,
        widthCm: 10,
        depthCm: 20,
        heightCm: 30,
        deliveryDaysMin: 2,
        deliveryDaysMax: 4,
        availableWebManual: true,
        availableWholesaleManual: true,
        availableExportManual: true,
        availableWebAuto: true,
        availableWholesaleAuto: true,
        availableExportAuto: true,
        dcAvailableQty: 5,
        warehouseStocks: { create: { warehouseId, qty: 5 } },
      },
      select: { id: true },
    });
    productId = product.id;
    const [fullClient, readClient] = await db.$transaction([
      db.partnerApiClient.create({
        data: {
          name: `QA partner full ${runId}`,
          keyPrefix: token.slice(0, 18),
          keyHash: hashToken(token),
          scopes: ["inventory:read", "reservations:write"],
          rateLimit: 100,
        },
        select: { id: true },
      }),
      db.partnerApiClient.create({
        data: {
          name: `QA partner read ${runId}`,
          keyPrefix: readToken.slice(0, 18),
          keyHash: hashToken(readToken),
          scopes: ["inventory:read"],
          rateLimit: 100,
        },
        select: { id: true },
      }),
    ]);
    fullClientId = fullClient.id;
    readClientId = readClient.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: [fullClientId, readClientId].filter(Boolean) } },
          { action: { startsWith: "partner.reservation" }, diff: { path: ["sku"], equals: sku } },
        ],
      },
    });
    if (fullClientId || readClientId) {
      await db.rateLimitBucket.deleteMany({
        where: {
          key: {
            in: [fullClientId, readClientId]
              .filter(Boolean)
              .map(partnerRateLimitKey),
          },
        },
      });
    }
    if (productId) {
      await db.partnerReservation.deleteMany({ where: { productId } });
      await db.stockMovement.deleteMany({ where: { productId } });
      await db.warehouseStock.deleteMany({ where: { productId } });
      await db.product.deleteMany({ where: { id: productId } });
    }
    await db.partnerApiClient.deleteMany({
      where: { id: { in: [fullClientId, readClientId].filter(Boolean) } },
    });
    if (warehouseId) {
      await db.warehouse.deleteMany({ where: { id: warehouseId } });
    }
    if (originalDefaultWarehouseIds.length) {
      await db.warehouse.updateMany({
        where: { id: { in: originalDefaultWarehouseIds } },
        data: { isDefault: true },
      });
    }
    await db.$disconnect();
  });

  test("enforces auth and scopes, reports stock and serializes duplicate reservations", async ({
    request,
  }) => {
    const anonymous = await request.get(`/api/partners/v1/inventory?sku=${sku}`);
    expect(anonymous.status()).toBe(401);

    const forbidden = await request.post("/api/partners/v1/reservations", {
      headers: {
        authorization: `Bearer ${readToken}`,
        "idempotency-key": idempotencyKey,
      },
      data: { sku, qty: 1, externalRef: `READ-${runId}` },
    });
    expect(forbidden.status()).toBe(403);

    const initialInventory = await request.get(
      `/api/partners/v1/inventory?sku=${encodeURIComponent(sku)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(initialInventory.status()).toBe(200);
    expect(initialInventory.headers()["x-ratelimit-limit"]).toBe("100");
    expect(await initialInventory.json()).toMatchObject({
      ok: true,
      items: [{ sku, physical: 5, reserved: 0, available: 5 }],
    });

    const missingKey = await request.post("/api/partners/v1/reservations", {
      headers: { authorization: `Bearer ${token}` },
      data: { sku, qty: 1, externalRef: `NO-KEY-${runId}` },
    });
    expect(missingKey.status()).toBe(400);

    const insufficient = await request.post("/api/partners/v1/reservations", {
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": `${idempotencyKey}-too-many`,
      },
      data: { sku, qty: 6, externalRef: `TOO-MANY-${runId}` },
    });
    expect(insufficient.status()).toBe(409);

    const duplicates = await Promise.all(
      Array.from({ length: 6 }, () =>
        request.post("/api/partners/v1/reservations", {
          headers: {
            authorization: `Bearer ${token}`,
            "idempotency-key": idempotencyKey,
          },
          data: { sku, qty: 2, externalRef: `ORDER-${runId}` },
        }),
      ),
    );
    expect(duplicates.filter((response) => response.status() === 201)).toHaveLength(1);
    expect(duplicates.filter((response) => response.status() === 200)).toHaveLength(5);
    expect(
      (await Promise.all(duplicates.map((response) => response.json()))).every(
        (payload) => payload.ok === true,
      ),
    ).toBe(true);

    expect(
      await db.partnerReservation.count({
        where: { clientId: fullClientId, idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await db.stockMovement.count({
        where: {
          idempotencyKey: `partner-reservation:${fullClientId}:${idempotencyKey}`,
        },
      }),
    ).toBe(1);

    const finalInventory = await request.get(
      `/api/partners/v1/inventory?sku=${encodeURIComponent(sku)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(finalInventory.status()).toBe(200);
    expect(await finalInventory.json()).toMatchObject({
      ok: true,
      items: [{ sku, physical: 5, reserved: 2, available: 3 }],
    });

    const actions = new Set(
      (
        await db.auditLog.findMany({
          where: {
            OR: [
              { entityId: fullClientId },
              { action: { startsWith: "partner.reservation" } },
            ],
          },
          select: { action: true },
        })
      ).map((entry) => entry.action),
    );
    expect(actions.has("partner.inventory.read")).toBe(true);
    expect(actions.has("partner.reservation.create")).toBe(true);
    expect(actions.has("partner.reservation.idempotent")).toBe(true);
  });
});

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function partnerRateLimitKey(clientId: string) {
  const digest = createHash("sha256")
    .update(clientId.trim().toLowerCase())
    .digest("base64url");
  return `partner-api:${digest}`;
}

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the partner API acceptance.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
