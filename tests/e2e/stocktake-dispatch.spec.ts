import { expect as baseExpect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const expect = baseExpect.configure({ timeout: 30_000 });

test.describe("Tačka 17 — Popisi kao otpremnice", () => {
  test.skip(
    process.env.E2E_STOCKTAKE_DISPATCH !== "1" || !databaseUrl(),
    "Set E2E_STOCKTAKE_DISPATCH=1 and provide an isolated database URL.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.popisi.${runId}@example.invalid`,
    adminPassword: `QaPopisi!${runId}x`,
    warehouseCode: `QA-POP-${runId}`.slice(0, 30),
    warehouseName: `QA magacin za popis ${runId}`,
    sku: `QA-POP-${runId}`.slice(0, 90),
    slug: `qa-popis-${runId}`,
    productName: `QA artikal za popis ${runId}`,
  };

  let db: PrismaClient;
  let adminId = "";
  let warehouseId = "";
  let productId = "";
  let dispatchId = "";
  let dispatchNumber = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();

    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const [admin, warehouse, product] = await Promise.all([
      db.adminUser.create({
        data: {
          email: fixture.adminEmail,
          passwordHash,
          role: "OPS",
          enabled: true,
          firstName: "QA",
          lastName: "Popisi",
        },
        select: { id: true },
      }),
      db.warehouse.create({
        data: {
          code: fixture.warehouseCode,
          name: fixture.warehouseName,
          active: true,
          isDefault: false,
        },
        select: { id: true },
      }),
      db.product.create({
        data: {
          sku: fixture.sku,
          slug: fixture.slug,
          name: fixture.productName,
          shortName: fixture.productName,
          description: "Privremeni artikal za browser prihvatni test Popisa.",
          fullPrice: 1000,
          stock: 10,
          isActive: true,
        },
        select: { id: true },
      }),
    ]);
    adminId = admin.id;
    warehouseId = warehouse.id;
    productId = product.id;

    await db.warehouseStock.create({
      data: { warehouseId, productId, qty: 10 },
    });
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("OPS admin kreira i knjiži Popis kroz browser", async ({
    context,
    page,
  }) => {
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const baseUrl =
      process.env.PLAYWRIGHT_BASE_URL ??
      `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`;
    await context.addCookies([
      { name: "spc_cookie_consent", value: "essential", url: baseUrl },
    ]);

    await test.step("ruta je zaštićena i Tačka 17 je Popisi", async () => {
      await page.goto("/admin/erp/popisi", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/admin\/prijava/);
      await page.getByLabel("E-pošta").fill(fixture.adminEmail);
      await page.getByLabel("Lozinka").fill(fixture.adminPassword);
      await page.getByRole("button", { name: "Prijavi se" }).click();
      await expect(page).toHaveURL(/\/admin\/erp\/popisi$/);
      await expect(
        page.getByRole("heading", { name: "Popisi", exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("Tačka 17", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Novi popis", exact: true }).first(),
      ).toBeVisible();

      const headers = await page
        .locator("table")
        .first()
        .locator("thead th")
        .allInnerTexts();
      expect(headers.map((header) => header.trim()).filter(Boolean)).toEqual([
        "Broj",
        "Magacin firme koja šalje robu",
        "Magacin firme koja prima robu",
        "Status",
        "Stavke",
        "Ukupna količina",
        "Proknjiženo",
        "Kreirano",
      ]);
    });

    await test.step("novi Popis je STOCKTAKE otpremnica sa fiksnim odredištem Popis", async () => {
      await page
        .getByRole("button", { name: "Novi popis", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/admin\/erp\/popisi\/[^/?]+\?mode=edit$/);
      dispatchId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

      const dispatch = await db.dispatchNote.findUniqueOrThrow({
        where: { id: dispatchId },
      });
      dispatchNumber = dispatch.number;
      expect(dispatch).toMatchObject({
        type: "STOCKTAKE",
        status: "DRAFT",
        destinationWarehouseId: null,
        destinationName: "Popis",
      });
      expect(dispatch.number).toMatch(/^POP-\d{4}-\d{4}$/);

      const receivingWarehouse = page.locator('input[value="Popis"][disabled]');
      await expect(receivingWarehouse).toHaveValue("Popis");
      await expect(receivingWarehouse).toBeDisabled();
    });

    await test.step("admin bira izvorni magacin i dodaje artikal", async () => {
      await page
        .locator('select[name="sourceWarehouseId"]')
        .selectOption(warehouseId);
      await page.locator('textarea[name="notes"]').fill("QA browser provera");
      await page.getByRole("button", { name: "Sačuvaj podatke" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Podaci popisa su sačuvani." }),
      ).toBeVisible();

      await page.locator('input[name="sku"]').fill(fixture.sku);
      await page.locator('input[name="qty"]').first().fill("3");
      await page.getByRole("button", { name: "Dodaj stavku" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: `Artikal ${fixture.sku} je dodat.` }),
      ).toBeVisible();
      const row = page.getByRole("row").filter({
        has: page.getByText(fixture.sku, { exact: true }),
      });
      await expect(row).toContainText(fixture.productName);
      await expect(row).toContainText("10");
      await expect(page.getByLabel(`Količina za ${fixture.sku}`)).toHaveValue("3");

      const stored = await db.dispatchNote.findUniqueOrThrow({
        where: { id: dispatchId },
        include: { items: true },
      });
      expect(stored).toMatchObject({
        sourceWarehouseId: warehouseId,
        destinationName: "Popis",
        notes: "QA browser provera",
      });
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0]).toMatchObject({
        productId,
        sku: fixture.sku,
        qty: 3,
      });
    });

    await test.step("knjiženje skida zalihu i zaključava dokument", async () => {
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Proknjiži popis" }).click();
      await expect(
        page.getByRole("status").filter({
          hasText: "Popis je proknjižen kao otpremnica.",
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/Dokument je proknjižen .* i više ga nije moguće menjati\./),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Proknjiži popis" })).toBeDisabled();
      await expect(page.getByText("Dodaj stavku", { exact: true })).toHaveCount(0);

      const [dispatch, stock, product, movement] = await Promise.all([
        db.dispatchNote.findUniqueOrThrow({ where: { id: dispatchId } }),
        db.warehouseStock.findUniqueOrThrow({
          where: { warehouseId_productId: { warehouseId, productId } },
        }),
        db.product.findUniqueOrThrow({ where: { id: productId } }),
        db.stockMovement.findFirstOrThrow({
          where: {
            warehouseId,
            productId,
            idempotencyKey: { startsWith: `stocktake-dispatch:${dispatchId}:` },
          },
        }),
      ]);
      expect(dispatch).toMatchObject({
        status: "POSTED",
        type: "STOCKTAKE",
        destinationWarehouseId: null,
        destinationName: "Popis",
        actorId: adminId,
      });
      expect(dispatch.postedAt).not.toBeNull();
      expect(stock.qty).toBe(7);
      expect(product.stock).toBe(7);
      expect(movement).toMatchObject({
        kind: "STOCK_COUNT",
        qty: -3,
        actorId: adminId,
        balanceAfterWarehouse: 7,
        balanceAfterTotal: 7,
      });
    });

    await test.step("Popis se vidi samo u Tački 17, ne u običnim otpremnicama", async () => {
      await page.goto("/admin/erp/popisi", { waitUntil: "domcontentloaded" });
      await page
        .getByPlaceholder("Brza pretraga po vidljivim kolonama")
        .fill(dispatchNumber);
      const row = page.getByRole("row").filter({
        has: page.getByText(dispatchNumber, { exact: true }),
      });
      await expect(row).toContainText(fixture.warehouseName);
      await expect(row).toContainText("Popis");
      await expect(row).toContainText("Proknjižen");

      await page.goto("/admin/erp/otpremnice", { waitUntil: "domcontentloaded" });
      await page
        .getByPlaceholder("Brza pretraga po vidljivim kolonama")
        .fill(dispatchNumber);
      await expect(page.getByText(dispatchNumber, { exact: true })).toHaveCount(0);
    });

    expect(pageErrors).toEqual([]);
  });

  async function cleanup() {
    if (!db) return;
    const stocktakeIds = (
      await db.dispatchNote.findMany({
        where: {
          OR: [
            ...(dispatchId ? [{ id: dispatchId }] : []),
            ...(warehouseId ? [{ sourceWarehouseId: warehouseId }] : []),
          ],
          type: "STOCKTAKE",
        },
        select: { id: true },
      })
    ).map((row) => row.id);

    if (stocktakeIds.length) {
      await db.dispatchNote.deleteMany({ where: { id: { in: stocktakeIds } } });
    }
    await db.stockMovement.deleteMany({ where: { sku: fixture.sku } });
    await db.warehouseStock.deleteMany({
      where: {
        OR: [
          { productId: productId || "__none__" },
          { warehouseId: warehouseId || "__none__" },
        ],
      },
    });
    await db.product.deleteMany({ where: { sku: fixture.sku } });
    await db.warehouse.deleteMany({ where: { code: fixture.warehouseCode } });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: adminId || "__none__" },
          { entityId: { in: stocktakeIds.length ? stocktakeIds : ["__none__"] } },
        ],
      },
    });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
  }
});

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("Database URL is required for Popisi acceptance.");
  const url = new URL(raw);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!isLocal && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
    throw new Error(
      "Remote Popisi acceptance requires E2E_ALLOW_REMOTE_DATABASE=1.",
    );
  }
  if (!isLocal) {
    url.searchParams.set("sslmode", url.searchParams.get("sslmode") || "require");
    url.searchParams.set("uselibpqcompat", "true");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 1 }),
  });
}

function databaseUrl() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
}
