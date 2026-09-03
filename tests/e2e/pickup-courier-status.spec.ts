import {
  expect as baseExpect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const expect = baseExpect.configure({ timeout: 30_000 });
const runId = `${Date.now()}-${process.pid}`;
const orderNumber = `QA-PICKUP-STATUS-${runId}`;
const adminEmail = `qa.pickup.status.${runId}@example.invalid`;
const adminPassword = `QaPickupStatus!${runId}x`;
const deliveredAt = new Date("2026-09-02T11:29:25.622Z");
const shippedAt = new Date("2026-08-31T14:26:44.800Z");

test.describe("Picking courier status regression", () => {
  test.skip(
    process.env.E2E_PICKUP_COURIER_STATUS !== "1" || !databaseUrl(),
    "Set E2E_PICKUP_COURIER_STATUS=1 and provide an isolated database URL.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  let db: PrismaClient;
  let adminId = "";
  let orderId = "";
  let batchId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: "OPS",
        enabled: true,
        firstName: "QA",
        lastName: "Courier status",
      },
      select: { id: true },
    });
    adminId = admin.id;

    const order = await db.order.create({
      data: {
        number: orderNumber,
        status: "ISPORUCENO",
        channel: "WEB",
        subtotal: 2_000,
        total: 2_000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Courier",
        shipPhone: "+38160111222",
        shipStreet: "Test statusa 13",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        guestEmail: `qa.order.${runId}@example.invalid`,
        termsAcceptedAt: new Date("2026-08-28T21:32:05.000Z"),
        items: {
          create: [
            {
              sku: `QA-STATUS-A-${runId}`.slice(0, 90),
              name: "Artikal čiji shipment pripada picking redu",
              qty: 1,
              unitPriceFull: 1_000,
              unitPriceSale: 1_000,
            },
            {
              sku: `QA-STATUS-B-${runId}`.slice(0, 90),
              name: "Artikal sa drugim shipmentom",
              qty: 1,
              unitPriceFull: 1_000,
              unitPriceSale: 1_000,
            },
          ],
        },
        events: {
          create: {
            status: "ISPORUCENO",
            note: "Isporučeno",
            createdAt: deliveredAt,
          },
        },
      },
      include: { items: { orderBy: { sku: "asc" } } },
    });
    orderId = order.id;
    const correctItem = order.items[0]!;
    const otherItem = order.items[1]!;

    const batch = await db.pickupBatch.create({
      data: {
        number: `PRE-QA-STATUS-${runId}`,
        courier: "COURIER_SMALL",
        provider: "X_EXPRESS",
        status: "BOOKED",
        lines: {
          create: {
            orderId,
            orderItemId: correctItem.id,
            purpose: "ORDER_DELIVERY",
            lineGroupKey: `order:${orderId}:X_EXPRESS`,
            quantity: 1,
            packageNo: 1,
            weightKg: 2,
            widthCm: 40,
            depthCm: 30,
            heightCm: 20,
            courierPickedUpAt: null,
          },
        },
      },
      select: { id: true },
    });
    batchId = batch.id;

    const deliveredShipment = await db.shipment.create({
      data: {
        orderId,
        service: "COURIER_SMALL",
        provider: "X_EXPRESS",
        purpose: "ORDER_DELIVERY",
        status: "DELIVERED",
        trackingNo: `QA-DELIVERED-${runId}`,
        packageCount: 1,
        shippedAt,
        deliveredAt,
        lastStatusEventAt: deliveredAt,
        rawCreateResponse: {
          assignment: { orderItemIds: [correctItem.id], codAmount: 1_000 },
        },
        createdAt: new Date("2026-08-30T13:46:25.181Z"),
        updatedAt: deliveredAt,
      },
      select: { id: true },
    });
    await db.shipmentEvent.create({
      data: {
        shipmentId: deliveredShipment.id,
        status: "DELIVERED",
        providerStatusCode: "DELIVERED",
        providerEventId: `qa-delivered-${runId}`,
        message: "Isporučeno",
        occurredAt: deliveredAt,
      },
    });

    // This newer shipment must not leak into the picking row because it belongs
    // to the other order item.
    await db.shipment.create({
      data: {
        orderId,
        service: "COURIER_SMALL",
        provider: "X_EXPRESS",
        purpose: "ORDER_DELIVERY",
        status: "FAILED",
        trackingNo: `QA-WRONG-${runId}`,
        packageCount: 1,
        lastStatusEventAt: new Date("2026-09-03T11:29:25.622Z"),
        rawCreateResponse: {
          assignment: { orderItemIds: [otherItem.id], codAmount: 1_000 },
        },
        createdAt: new Date("2026-08-31T13:46:25.181Z"),
        updatedAt: new Date("2026-09-03T11:29:25.622Z"),
      },
    });
  });

  test.afterAll(async () => {
    try {
      if (batchId) await db.pickupBatch.deleteMany({ where: { id: batchId } });
      if (orderId) await db.order.deleteMany({ where: { id: orderId } });
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({
        where: { key: { contains: adminEmail } },
      });
      await db.adminUser.deleteMany({ where: { email: adminEmail } });
    } finally {
      await db?.$disconnect();
    }
  });

  test("picking and sales order show the same delivered shipment status", async ({
    context,
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await login(context, page);

    await page.goto(`/admin/erp/preuzimanja/${batchId}`, {
      waitUntil: "domcontentloaded",
    });
    const pickingRow = page.getByRole("row").filter({
      has: page.getByText(orderNumber, { exact: true }),
    });
    await expect(pickingRow).toHaveCount(1);
    await expect(
      pickingRow.getByText("Isporučeno", { exact: true }),
    ).toBeVisible();
    await expect(pickingRow).toContainText("1/1 kompletno");
    await expect(pickingRow).toContainText(formatBelgradeDateTime(deliveredAt));
    await expect(pickingRow).not.toContainText("Čeka status kurira");
    await expect(pickingRow).not.toContainText("Neuspešna isporuka");

    // This is deliberately a legacy row: rendering must recover from the
    // shipment even before a database backfill has populated the marker.
    await expect
      .poll(async () =>
        (
          await db.pickupBatchLine.findFirstOrThrow({
            where: { batchId },
            select: { courierPickedUpAt: true },
          })
        ).courierPickedUpAt,
      )
      .toBeNull();

    await page.goto(`/admin/erp/prodajni-nalozi/${orderId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", {
        name: `Porudžbina ${orderNumber}`,
        exact: true,
      }),
    ).toBeVisible();
    const timelineCard = page
      .getByRole("heading", { name: "Status timeline", exact: true })
      .locator("../..");
    await expect(timelineCard).toContainText("ISPORUCENO");
    await expect(timelineCard).toContainText("Isporučeno");
    expect(pageErrors).toEqual([]);
  });
});

async function login(
  context: BrowserContext,
  page: Page,
) {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  await context.addCookies([
    { name: "spc_cookie_consent", value: "essential", url: baseUrl },
  ]);
  await page.goto("/admin/erp/preuzimanja", {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/\/admin\/prijava/);
  await page.getByLabel("E-pošta").fill(adminEmail);
  await page.getByLabel("Lozinka").fill(adminPassword);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page).toHaveURL(/\/admin\/erp\/preuzimanja$/, {
    timeout: 90_000,
  });
}

function formatBelgradeDateTime(value: Date) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Belgrade",
  }).format(value);
}

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("An isolated database URL is required.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!isLocal && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
    throw new Error("Remote status acceptance requires E2E_ALLOW_REMOTE_DATABASE=1.");
  }
  if (!isLocal) {
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }, { schema }),
  });
}

function databaseUrl() {
  return [
    process.env.E2E_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
}
