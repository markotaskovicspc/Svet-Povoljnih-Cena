import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("Pretraga ručne fiskalizacije", () => {
  test.skip(
    process.env.E2E_FISCALIZATION_SEARCH !== "1" || !databaseUrl(),
    "Set E2E_FISCALIZATION_SEARCH=1 and provide an isolated database URL.",
  );
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const prefix = `QA-FISK-${runId}`;
  const fixture = {
    adminEmail: `qa.fisk.${runId}@example.invalid`,
    adminPassword: `QaFisk!${runId}`,
    oldOrderNumber: `${prefix}-000354`.slice(0, 80),
    newerOrderNumber: `${prefix}-000356`.slice(0, 80),
    oldSku: `${prefix}-STARI`.slice(0, 80),
    newerSku: `${prefix}-NOVI`.slice(0, 80),
  };

  let db: PrismaClient;
  let warehouseId = "";
  let oldOrderId = "";
  let newerOrderId = "";
  let oldItemId = "";
  let newerItemId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();

    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const [, warehouse, oldProduct, newerProduct] = await Promise.all([
      db.adminUser.create({
        data: {
          email: fixture.adminEmail,
          passwordHash,
          role: "SUPER",
          enabled: true,
          firstName: "QA",
          lastName: "Fiskalizacija",
        },
      }),
      db.warehouse.create({
        data: {
          code: `QA-FISK-${runId}`.slice(0, 40),
          name: `${prefix} DC`,
          active: true,
          isDefault: true,
        },
      }),
      createProduct(fixture.oldSku, `${prefix} stari artikal`),
      createProduct(fixture.newerSku, `${prefix} novi artikal`),
    ]);
    warehouseId = warehouse.id;

    const oldOrder = await db.order.create({
      data: {
        ...orderData(fixture.oldOrderNumber),
        createdAt: new Date("2025-01-01T10:00:00.000Z"),
        shipFirstName: "Goran",
        shipLastName: "Martinov",
        shipCity: "Vršac",
        items: {
          create: orderItemData(oldProduct, 1),
        },
      },
      include: { items: true },
    });
    const newerOrder = await db.order.create({
      data: {
        ...orderData(fixture.newerOrderNumber),
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
        paymentMethod: "UPLATA_NA_RACUN",
        shipFirstName: "Ivan",
        shipLastName: "Barac",
        shipCity: "Prokuplje",
        items: {
          create: orderItemData(newerProduct, 2),
        },
      },
      include: { items: true },
    });
    oldOrderId = oldOrder.id;
    newerOrderId = newerOrder.id;
    oldItemId = oldOrder.items[0]!.id;
    newerItemId = newerOrder.items[0]!.id;
  }, 90_000);

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("filtrira po broju, kupcu i mestu, menja payload i Enter ne šalje formu", async ({
    context,
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3051",
      },
    ]);

    await page.goto("/admin/fiskalizacija", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/prijava/);
    await login(page);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Ručna fiskalizacija" }).click();

    const dialog = page.getByRole("dialog", { name: "Ručna fiskalizacija" });
    await expect(dialog).toBeVisible();
    const orderSearch = dialog.getByRole("combobox", { name: "Porudžbina" });
    const hiddenOrderId = dialog.locator('input[name="orderId"]');
    const hiddenItemIds = dialog.locator('input[name="orderItemIds"]');
    const paymentMethod = dialog.locator('select[name="paymentMethod"]');
    const fiscalizeButton = dialog
      .locator('button[type="submit"]')
      .filter({ hasText: "Fiskalizuj" });
    const fiscalDocumentsBefore = await fiscalDocumentCount();

    await orderSearch.fill("000354");
    const oldOption = page.getByRole("option").filter({
      hasText: fixture.oldOrderNumber,
    });
    await expect(oldOption).toBeVisible();
    await expect(oldOption).toContainText("Goran Martinov");
    await expect(oldOption).toContainText("Vršac");
    await expect(
      page.getByRole("option").filter({ hasText: fixture.newerOrderNumber }),
    ).toHaveCount(0);

    await orderSearch.press("ArrowDown");
    await orderSearch.press("Enter");
    await expect(orderSearch).toHaveValue(
      `${fixture.oldOrderNumber} · Goran Martinov · Vršac`,
    );
    await expect(hiddenOrderId).toHaveValue(oldOrderId);
    await expect(hiddenItemIds).toHaveCount(1);
    await expect(hiddenItemIds).toHaveValue(oldItemId);
    await expect(paymentMethod).toHaveValue("POUZECE_GOTOVINA");
    await expect(dialog.getByText(`${prefix} stari artikal`, { exact: true })).toBeVisible();

    await orderSearch.fill("Ivan Barac");
    const newerOption = page.getByRole("option").filter({
      hasText: fixture.newerOrderNumber,
    });
    await expect(newerOption).toBeVisible();
    await expect(newerOption).toContainText("Prokuplje");
    await orderSearch.fill("Prokuplje");
    await expect(newerOption).toBeVisible();
    await newerOption.click();

    await expect(hiddenOrderId).toHaveValue(newerOrderId);
    await expect(hiddenItemIds).toHaveCount(1);
    await expect(hiddenItemIds).toHaveValue(newerItemId);
    await expect(paymentMethod).toHaveValue("UPLATA_NA_RACUN");
    await expect(dialog.getByText(`${prefix} novi artikal`, { exact: true })).toBeVisible();
    await expect(dialog.getByText(`${prefix} stari artikal`, { exact: true })).toHaveCount(0);
    await expect(fiscalizeButton).toBeEnabled();

    await orderSearch.fill("NEPOSTOJECA-PORUDZBINA");
    await expect(
      page.getByText("Nema porudžbina za unetu pretragu.", { exact: true }),
    ).toBeVisible();
    await expect(fiscalizeButton).toBeDisabled();
    await orderSearch.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(hiddenOrderId).toHaveValue(newerOrderId);
    expect(await fiscalDocumentCount()).toBe(fiscalDocumentsBefore);
    expect(runtimeErrors).toEqual([]);
  });

  async function login(page: Page) {
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/fiskalizacija$/, { timeout: 30_000 });
  }

  async function createProduct(sku: string, name: string) {
    return db.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name,
        description: "Privremeni proizvod za test pretrage fiskalizacije.",
        fullPrice: 1_000,
        isActive: false,
      },
    });
  }

  function orderData(number: string) {
    return {
      number,
      status: "U_ISPORUCI" as const,
      channel: "WEB" as const,
      guestEmail: `kupac.${runId}@example.invalid`,
      subtotal: 1_000,
      total: 1_000,
      shippingMethod: "KURIR" as const,
      paymentMethod: "POUZECE_GOTOVINA" as const,
      shipFirstName: "QA",
      shipLastName: "Kupac",
      shipPhone: "+381600000000",
      shipStreet: "Test 1",
      shipCity: "Beograd",
      shipPostalCode: "11000",
      termsAcceptedAt: new Date(),
    };
  }

  function orderItemData(product: { id: string; sku: string; name: string }, qty: number) {
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      supplierName: "QA dobavljač",
      qty,
      unitPriceFull: 1_000,
      unitPriceSale: 1_000,
      warehouseId,
    };
  }

  async function fiscalDocumentCount() {
    return db.fiscalDocument.count({
      where: { orderId: { in: [oldOrderId, newerOrderId] } },
    });
  }

  async function cleanup() {
    if (!db) return;
    const orders = await db.order.findMany({
      where: { number: { startsWith: prefix } },
      select: { id: true },
    });
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length) {
      await db.fiscalDocument.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await db.product.deleteMany({ where: { sku: { startsWith: prefix } } });
    const admin = await db.adminUser.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true },
    });
    if (admin) {
      await db.auditLog.deleteMany({ where: { actorId: admin.id } });
      await db.adminUser.delete({ where: { id: admin.id } });
    }
    if (warehouseId) {
      await db.warehouse.deleteMany({ where: { id: warehouseId } });
    }
    warehouseId = "";
    oldOrderId = "";
    newerOrderId = "";
    oldItemId = "";
    newerItemId = "";
  }
});

function databaseUrl() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
}

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("Database URL is required for fiscalization search QA.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url.toString(),
        max: 1,
        connectionTimeoutMillis: 15_000,
      },
      { schema },
    ),
  });
}
