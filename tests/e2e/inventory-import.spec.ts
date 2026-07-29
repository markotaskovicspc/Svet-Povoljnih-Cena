// Acceptance: STOCK-02
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("STOCK-02 — bezbedan DC lager import", () => {
  test.skip(
    process.env.E2E_INVENTORY_IMPORT !== "1" || !databaseUrl(),
    "Set E2E_INVENTORY_IMPORT=1 and provide an isolated database URL.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.inventory.import.${runId}@example.invalid`,
    adminPassword: `QaInventory!${runId}x`,
    successA: `QA-IMP-A-${runId}`.slice(0, 90),
    successB: `QA-IMP-B-${runId}`.slice(0, 90),
    drift: `QA-IMP-DRIFT-${runId}`.slice(0, 90),
    rollbackA: `QA-IMP-ROLL-A-${runId}`.slice(0, 90),
    rollbackB: `QA-IMP-ROLL-B-${runId}`.slice(0, 90),
    orderNumber: `QA-IMP-ORDER-${runId}`.slice(0, 80),
  };

  let db: PrismaClient;
  let adminId = "";
  let warehouseId = "";
  let orderId = "";
  const productIds: Record<string, string> = {};

  test.beforeAll(async () => {
    assertLocalTestDatabase();
    db = createDatabaseClient();

    const warehouse = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!warehouse) throw new Error("STOCK-02 requires a default QA warehouse.");
    warehouseId = warehouse.id;

    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash: await bcrypt.hash(fixture.adminPassword, 12),
        role: "OPS",
        enabled: true,
        firstName: "QA",
        lastName: "Inventory import",
      },
      select: { id: true },
    });
    adminId = admin.id;

    for (const [key, sku, stock] of [
      ["successA", fixture.successA, 3],
      ["successB", fixture.successB, 4],
      ["drift", fixture.drift, 5],
      ["rollbackA", fixture.rollbackA, 1],
      ["rollbackB", fixture.rollbackB, 0],
    ] as const) {
      const product = await db.product.create({
        data: {
          sku,
          slug: `qa-inventory-${key.toLowerCase()}-${runId}`,
          name: `QA inventory ${key} ${runId}`,
          shortName: `QA ${key}`,
          description: "Izolovani STOCK-02 acceptance artikal.",
          shortDescription: "STOCK-02 fixture",
          fullPrice: 1000,
          stock,
          warehouseStocks: {
            create: { warehouseId, qty: stock },
          },
        },
        select: { id: true },
      });
      productIds[key] = product.id;
    }

    const order = await db.order.create({
      data: {
        number: fixture.orderNumber,
        channel: "WEB",
        subtotal: 2000,
        total: 2000,
        shippingMethod: "KURIR",
        paymentMethod: "UPLATA_NA_RACUN",
        shipFirstName: "QA",
        shipLastName: "Reservation",
        shipPhone: "+38160000000",
        shipStreet: "Test 1",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        guestEmail: `qa.inventory.order.${runId}@example.invalid`,
        termsAcceptedAt: new Date(),
        items: {
          create: {
            productId: productIds.rollbackB,
            sku: fixture.rollbackB,
            name: `QA reserved ${runId}`,
            qty: 2,
            unitPriceFull: 1000,
            unitPriceSale: 1000,
            warehouseId,
            warehouseReservedQty: 2,
          },
        },
      },
      select: { id: true },
    });
    orderId = order.id;
  });

  test.afterAll(async () => {
    try {
      if (orderId) await db.order.deleteMany({ where: { id: orderId } });
      const ids = Object.values(productIds);
      if (ids.length) {
        await db.stockMovement.deleteMany({ where: { productId: { in: ids } } });
        await db.warehouseStock.deleteMany({ where: { productId: { in: ids } } });
        await db.product.deleteMany({ where: { id: { in: ids } } });
      }
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({
        where: { key: { contains: fixture.adminEmail } },
      });
      await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
    } finally {
      await db?.$disconnect();
    }
  });

  test("OPS admin prolazi validaciju, preview, state gate, rollback, apply i idempotent retry", async ({
    context,
    page,
  }) => {
    page.setDefaultTimeout(20_000);
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);
    await page.goto("/admin/erp/stanje-po-magacinima", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Lager i kretanja" })).toBeVisible();

    const form = importForm(page);

    await test.step("svi redovi se validiraju pre bilo kakve promene", async () => {
      await previewCsv(
        form,
        `sku,qty\n${fixture.successA},8\n${fixture.successA},9\n`,
        "duplicate.csv",
      );
      await expect(form.getByRole("alert")).toContainText("se ponavlja");

      await previewCsv(form, "sku,qty\nQA-NE-POSTOJI,4\n", "unknown.csv");
      await expect(form.getByRole("alert")).toContainText("Nepoznati SKU");
      await expect(movementCount()).resolves.toBe(0);
      await expect(stock(productIds.successA)).resolves.toEqual({
        product: 3,
        warehouse: 3,
      });
    });

    await test.step("preview token odbija fajl ili lager promenjen posle pregleda", async () => {
      const csv = `sku,qty\n${fixture.drift},9\n`;
      await previewCsv(form, csv, "state-drift.csv");
      await expect(form.getByRole("status")).toContainText("Provera je uspešna");
      await expect(form.locator('input[name="previewToken"]')).not.toHaveValue("");

      await db.$transaction([
        db.product.update({ where: { id: productIds.drift }, data: { stock: 6 } }),
        db.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId,
              productId: productIds.drift,
            },
          },
          data: { qty: 6 },
        }),
      ]);
      await setCsv(form, csv, "state-drift.csv");
      await confirmSubmit(
        page,
        form.getByRole("button", { name: "Primeni pregledani uvoz" }),
        true,
      );
      await expect(form.getByRole("alert")).toContainText(
        "Fajl ili lager su promenjeni od pregleda",
      );
      await expect(stock(productIds.drift)).resolves.toEqual({
        product: 6,
        warehouse: 6,
      });
      await expect(movementCount()).resolves.toBe(0);

      await db.$transaction([
        db.product.update({ where: { id: productIds.drift }, data: { stock: 5 } }),
        db.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId,
              productId: productIds.drift,
            },
          },
          data: { qty: 5 },
        }),
      ]);
    });

    await test.step("greška na kasnijem redu vraća ceo import unazad", async () => {
      const csv = [
        "sku,qty,widthCm,depthCm,heightCm",
        `${fixture.rollbackA},5,11,12,13`,
        `${fixture.rollbackB},0,,,`,
        "",
      ].join("\n");
      await previewCsv(form, csv, "atomic-rollback.csv");
      await setCsv(form, csv, "atomic-rollback.csv");
      await confirmSubmit(
        page,
        form.getByRole("button", { name: "Primeni pregledani uvoz" }),
        true,
      );
      await expect(form.getByRole("alert")).toContainText("Nema dovoljno zaliha");
      await expect(stock(productIds.rollbackA)).resolves.toEqual({
        product: 1,
        warehouse: 1,
      });
      const rolledBackProduct = await db.product.findUniqueOrThrow({
        where: { id: productIds.rollbackA },
        select: { widthCm: true, depthCm: true, heightCm: true },
      });
      expect(rolledBackProduct).toEqual({
        widthCm: null,
        depthCm: null,
        heightCm: null,
      });
      await expect(movementCount()).resolves.toBe(0);
    });

    await test.step("potvrda primenjuje samo pregledane razlike i dimenzije", async () => {
      const csv = [
        "sku,qty,widthCm,depthCm,heightCm",
        `${fixture.successA},8,10.5,20.5,30.5`,
        `${fixture.successB},2,,,`,
        "",
      ].join("\n");
      await previewCsv(form, csv, "success.csv");
      await expect(
        form.getByText("Redova", { exact: true }).locator(".."),
      ).toContainText("2");
      await expect(
        form.getByText("Promene", { exact: true }).locator(".."),
      ).toContainText("2");
      await expect(form.getByText(fixture.successA, { exact: true })).toBeVisible();

      await setCsv(form, csv, "success.csv");
      await confirmSubmit(
        page,
        form.getByRole("button", { name: "Primeni pregledani uvoz" }),
        false,
      );
      await expect(stock(productIds.successA)).resolves.toEqual({
        product: 3,
        warehouse: 3,
      });

      await confirmSubmit(
        page,
        form.getByRole("button", { name: "Primeni pregledani uvoz" }),
        true,
      );
      await expect(form.getByRole("status")).toContainText("DC uvoz je završen");
      await expect(stock(productIds.successA)).resolves.toEqual({
        product: 8,
        warehouse: 8,
      });
      await expect(stock(productIds.successB)).resolves.toEqual({
        product: 2,
        warehouse: 2,
      });
      const product = await db.product.findUniqueOrThrow({
        where: { id: productIds.successA },
        select: {
          widthCm: true,
          depthCm: true,
          heightCm: true,
          syncOverrides: true,
        },
      });
      expect(Number(product.widthCm)).toBe(10.5);
      expect(Number(product.depthCm)).toBe(20.5);
      expect(Number(product.heightCm)).toBe(30.5);
      expect(JSON.stringify(product.syncOverrides)).toContain("dimensions");
      await expect(movementCount()).resolves.toBe(2);
    });

    await test.step("identičan retry ne pravi nove pokrete", async () => {
      const csv = [
        "sku,qty,widthCm,depthCm,heightCm",
        `${fixture.successA},8,10.5,20.5,30.5`,
        `${fixture.successB},2,,,`,
        "",
      ].join("\n");
      await previewCsv(form, csv, "success.csv");
      await setCsv(form, csv, "success.csv");
      await confirmSubmit(
        page,
        form.getByRole("button", { name: "Primeni pregledani uvoz" }),
        true,
      );
      await expect(form.getByRole("status")).toContainText(
        "identičan lager fajl je već primenjen",
      );
      await expect(movementCount()).resolves.toBe(2);

      const actions = new Set(
        (
          await db.auditLog.findMany({
            where: { actorId: adminId },
            select: { action: true },
          })
        ).map((entry) => entry.action),
      );
      expect(actions).toContain("inventory.openingImport");
      expect(actions).toContain("inventory.openingImport.error");
    });
  });

  async function login(page: Page) {
    await page.goto(
      "/admin/prijava?callbackUrl=%2Fadmin%2Ferp%2Fstanje-po-magacinima",
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/erp\/stanje-po-magacinima$/);
  }

  async function stock(productId: string) {
    const [product, warehouse] = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: productId }, select: { stock: true } }),
      db.warehouseStock.findUniqueOrThrow({
        where: { warehouseId_productId: { warehouseId, productId } },
        select: { qty: true },
      }),
    ]);
    return { product: product.stock, warehouse: warehouse.qty };
  }

  function movementCount() {
    return db.stockMovement.count({
      where: { productId: { in: Object.values(productIds) } },
    });
  }
});

function importForm(page: Page) {
  return page.locator("form").filter({
    has: page.getByRole("button", { name: "Proveri fajl" }),
  });
}

async function previewCsv(form: Locator, csv: string, name: string) {
  await setCsv(form, csv, name);
  await form.getByRole("button", { name: "Proveri fajl" }).click();
}

async function setCsv(form: Locator, csv: string, name: string) {
  await form.locator('input[name="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
}

async function confirmSubmit(page: Page, button: Locator, accept: boolean) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = button.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message().length).toBeGreaterThan(20);
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clickPromise;
}

function databaseUrl() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
}

function assertLocalTestDatabase() {
  const raw = databaseUrl();
  if (!raw) throw new Error("Database URL is required for STOCK-02 E2E.");
  const url = new URL(raw);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (!local || !url.pathname.toLowerCase().includes("test")) {
    throw new Error("STOCK-02 mutations require a local database whose name contains test.");
  }
}

function createDatabaseClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl()! }),
    transactionOptions: { maxWait: 30_000, timeout: 60_000 },
  });
}
