import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const DAY_MS = 86_400_000;

test.describe("Admin analitika reklamacija", () => {
  test.skip(
    process.env.E2E_RECLAMATION_ANALYTICS !== "1" || !databaseUrl(),
    "Set E2E_RECLAMATION_ANALYTICS=1 and provide a database URL.",
  );
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const prefix = `QA-REK-${runId}`;
  const fixture = {
    adminEmail: `qa.reklamacije.${runId}@example.invalid`,
    adminPassword: `QaReklamacije!${runId}`,
    supplierA: `${prefix} Alfa dobavljač`,
    supplierB: `${prefix} Beta dobavljač`,
    skuA: `${prefix}-A`.slice(0, 80),
    skuB: `${prefix}-B`.slice(0, 80),
    skuC: `${prefix}-C`.slice(0, 80),
    productA: `${prefix} Lampa A`,
    productB: `${prefix} Lampa B`,
    productC: `${prefix} Lampa C`,
    deliveredOrder: `${prefix}-ISPORUCENO`.slice(0, 80),
    activeOrder: `${prefix}-U-ISPORUCI`.slice(0, 80),
  };

  let db: PrismaClient;
  let mutableReclamationId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();

    const [adminPasswordHash, supplierA, supplierB] = await Promise.all([
      bcrypt.hash(fixture.adminPassword, 12),
      db.supplier.create({ data: { name: fixture.supplierA, enabled: false } }),
      db.supplier.create({ data: { name: fixture.supplierB, enabled: false } }),
    ]);
    await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash: adminPasswordHash,
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Reklamacije",
      },
    });

    const [productA, productB, productC] = await Promise.all([
      createProduct(fixture.skuA, fixture.productA, supplierA.id),
      createProduct(fixture.skuB, fixture.productB, supplierB.id),
      createProduct(fixture.skuC, fixture.productC, supplierA.id),
    ]);

    const deliveredOrder = await db.order.create({
      data: {
        ...orderData(fixture.deliveredOrder, "ISPORUCENO"),
        items: {
          create: [
            orderItemData(productA, fixture.supplierA, 100),
            orderItemData(productB, fixture.supplierB, 50),
            orderItemData(productC, fixture.supplierA, 20),
          ],
        },
      },
      include: { items: true },
    });
    await db.order.create({
      data: {
        ...orderData(fixture.activeOrder, "U_ISPORUCI"),
        items: { create: orderItemData(productA, fixture.supplierA, 900) },
      },
    });

    const itemA = deliveredOrder.items.find((item) => item.sku === fixture.skuA)!;
    const itemB = deliveredOrder.items.find((item) => item.sku === fixture.skuB)!;
    const itemC = deliveredOrder.items.find((item) => item.sku === fixture.skuC)!;
    const now = Date.now();
    const created = (daysAgo: number) => new Date(now - daysAgo * DAY_MS - 60_000);
    const resolved = (daysAgo: number) => new Date(now - daysAgo * DAY_MS);

    const mutable = await db.reclamation.create({
      data: reclamationData({
        suffix: "A-OPEN-31",
        orderId: deliveredOrder.id,
        item: itemA,
        type: "KVAR",
        createdAt: created(31),
      }),
    });
    mutableReclamationId = mutable.id;
    await db.reclamation.createMany({
      data: [
        reclamationData({
          suffix: "A-RESENO",
          orderId: deliveredOrder.id,
          item: itemA,
          status: "RESENO",
          type: "KVAR",
          resolution: "ZAMENA_ARTIKLA",
          createdAt: created(8),
          resolvedAt: resolved(4),
        }),
        reclamationData({
          suffix: "A-ODBIJENO",
          orderId: deliveredOrder.id,
          item: itemA,
          status: "ODBIJENO",
          createdAt: created(9),
          resolvedAt: resolved(3),
        }),
        reclamationData({
          suffix: "B-OPEN-11",
          orderId: deliveredOrder.id,
          item: itemB,
          type: "FIZICKO_OSTECENJE",
          createdAt: created(11),
        }),
        reclamationData({
          suffix: "B-RESENO",
          orderId: deliveredOrder.id,
          item: itemB,
          status: "RESENO",
          type: "KVAR",
          resolution: "POVRAT_NOVCA",
          createdAt: created(4),
          resolvedAt: resolved(2),
        }),
        reclamationData({
          suffix: "C-OPEN-6",
          orderId: deliveredOrder.id,
          item: itemC,
          type: "FIZICKO_OSTECENJE",
          createdAt: created(6),
        }),
      ],
    });
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("admin vidi tačne metrike, top artikle i funkcionalne filtere", async ({
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
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3016",
      },
    ]);

    await test.step("ruta zahteva admina i prijava radi", async () => {
      await page.goto("/admin/reklamacije", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/admin\/prijava/);
      await login(page);
      await expect(page).toHaveURL(/\/admin\/reklamacije$/);
      const pageHeading = page.getByRole("heading", {
        name: "Reklamacije",
        exact: true,
      });
      await expect(pageHeading).toHaveCount(1);
      await expect(pageHeading).toBeVisible();
    });

    await test.step("sve sekcije zahteva su prikazane", async () => {
      for (const heading of [
        "Ukupni pokazatelji",
        "Reklamacije po tipu",
        "Reklamacije po načinu rešavanja",
        "Isti pokazatelji po dobavljaču",
        "Top 20 artikala sa najviše reklamacija",
        "Obrada reklamacija",
      ]) {
        await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      }
      const overview = page.locator(
        'section[aria-labelledby="reclamation-overview"]',
      );
      for (const label of [
        "Ukupno reklamacija",
        "% reklamacija",
        "Rešene",
        "Nerešene",
        "Nerešene > 5 dana",
        "Nerešene > 10 dana",
        "Nerešene > 20 dana",
        "Nerešene > 30 dana",
        "Prosečno rešavanje",
      ]) {
        await expect(overview.getByText(label, { exact: true })).toBeVisible();
      }
    });

    await test.step("metrike po dobavljaču imaju tačne vrednosti", async () => {
      const supplierSection = page.locator('section[aria-labelledby="supplier-overview"]');
      const alfaRow = supplierSection.locator("tbody tr").filter({
        hasText: fixture.supplierA,
      });
      const betaRow = supplierSection.locator("tbody tr").filter({
        hasText: fixture.supplierB,
      });
      await expect(alfaRow).toHaveCount(1);
      await expect(betaRow).toHaveCount(1);

      expect((await alfaRow.locator("td").allInnerTexts()).map(normalize)).toEqual([
        `${fixture.supplierA} 120 isporučenih artikala`,
        "4",
        "3,33%",
        "Kvar: 2 Fizičko oštećenje: 1 Nije uneto: 1",
        "Nije određeno: 3 Zamena artikla: 1",
        "2",
        "2",
        "2",
        "1",
        "1",
        "1",
        "5,0 dana",
      ]);
      expect((await betaRow.locator("td").allInnerTexts()).map(normalize)).toEqual([
        `${fixture.supplierB} 50 isporučenih artikala`,
        "2",
        "4,0%",
        "Fizičko oštećenje: 1 Kvar: 1",
        "Nije određeno: 1 Povrat novca: 1",
        "1",
        "1",
        "1",
        "1",
        "0",
        "0",
        "2,0 dana",
      ]);
    });

    await test.step("top artikli koriste samo isporučene količine", async () => {
      const topSection = page.locator('section[aria-labelledby="top-products"]');
      const productRow = topSection.locator("tbody tr").filter({
        hasText: fixture.skuA,
      });
      await expect(productRow).toHaveCount(1);
      const cells = (await productRow.locator("td").allInnerTexts()).map(normalize);
      expect(cells.slice(1)).toEqual([
        fixture.productA,
        fixture.skuA,
        fixture.supplierA,
        "3",
        "100",
        "3,0%",
      ]);
    });

    await test.step("status filter utiče samo na operativni spisak", async () => {
      await page.locator('a[href="/admin/reklamacije?status=RESENO"]').click();
      await expect(page).toHaveURL(/status=RESENO/);
      const operations = page.locator(
        'section[aria-labelledby="reclamation-operations"]',
      );
      await expect(operations.getByText(`${prefix}-A-RESENO`, { exact: true })).toBeVisible();
      await expect(operations.getByText(`${prefix}-B-RESENO`, { exact: true })).toBeVisible();
      await expect(
        operations.getByText(`${prefix}-A-OPEN-31`, { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Ukupni pokazatelji" })).toBeVisible();
    });

    await test.step("postojeća promena statusa i istorija nisu pokvarene", async () => {
      await page.goto("/admin/reklamacije?status=PRIMLJENO", {
        waitUntil: "domcontentloaded",
      });
      const operations = page.locator(
        'section[aria-labelledby="reclamation-operations"]',
      );
      const card = operations.locator("div.rounded-2xl").filter({
        hasText: `${prefix}-A-OPEN-31`,
      });
      await expect(card).toHaveCount(1);
      await card.locator('select[name="status"]').selectOption("U_OBRADI");
      await card.locator('textarea[name="note"]').fill("QA provera analitike");
      await card.getByRole("button", { name: "Sačuvaj" }).click();
      await expect
        .poll(async () =>
          db.reclamation.findUnique({
            where: { id: mutableReclamationId },
            select: { status: true },
          }),
        )
        .toEqual({ status: "U_OBRADI" });
      await page.goto("/admin/reklamacije?status=U_OBRADI", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page
          .locator('section[aria-labelledby="reclamation-operations"]')
          .getByText(`${prefix}-A-OPEN-31`, { exact: true }),
      ).toBeVisible();
    });

    await test.step("mobilni prikaz nema horizontalni overflow stranice", async () => {
      if (test.info().project.name !== "mobile") return;
      await expect(page.getByRole("button", { name: "Otvori meni" })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      const supplierScroll = page
        .locator('section[aria-labelledby="supplier-overview"]')
        .locator(".overflow-x-auto");
      await expect(supplierScroll).toHaveCount(1);
      expect(
        await supplierScroll.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
    });

    expect(runtimeErrors).toEqual([]);
  });

  async function createProduct(sku: string, name: string, supplierId: string) {
    return db.product.create({
      data: {
        sku,
        slug: sku.toLowerCase(),
        name,
        description: "Privremeni QA artikal za analitiku reklamacija.",
        fullPrice: 1_000,
        supplierId,
        isActive: false,
      },
    });
  }

  async function login(page: Page) {
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/reklamacije$/, { timeout: 30_000 });
  }

  function orderData(number: string, status: "ISPORUCENO" | "U_ISPORUCI") {
    return {
      number,
      status,
      channel: "WEB" as const,
      guestEmail: `kupac.${runId}@example.invalid`,
      subtotal: 170_000,
      total: 170_000,
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

  function orderItemData(
    product: { id: string; sku: string; name: string },
    supplierName: string,
    qty: number,
  ) {
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      supplierName,
      qty,
      unitPriceFull: 1_000,
      unitPriceSale: 1_000,
    };
  }

  function reclamationData(input: {
    suffix: string;
    orderId: string;
    item: { id: string; productId: string | null; sku: string };
    status?: "PRIMLJENO" | "RESENO" | "ODBIJENO";
    type?: "KVAR" | "FIZICKO_OSTECENJE";
    resolution?: "ZAMENA_ARTIKLA" | "POVRAT_NOVCA";
    createdAt: Date;
    resolvedAt?: Date;
  }) {
    return {
      number: `${prefix}-${input.suffix}`,
      orderId: input.orderId,
      orderItemId: input.item.id,
      productId: input.item.productId,
      sku: input.item.sku,
      customerFirst: "QA",
      customerLast: "Kupac",
      description: "Privremena QA reklamacija za analitički prikaz.",
      notifyVia: "EMAIL" as const,
      status: input.status ?? ("PRIMLJENO" as const),
      type: input.type,
      resolution: input.resolution,
      createdAt: input.createdAt,
      resolvedAt: input.resolvedAt,
    };
  }

  async function cleanup() {
    if (!db) return;
    const reclamations = await db.reclamation.findMany({
      where: { number: { startsWith: prefix } },
      select: { id: true },
    });
    const reclamationIds = reclamations.map(({ id }) => id);
    if (reclamationIds.length) {
      await db.backgroundJob.deleteMany({
        where: {
          OR: reclamationIds.flatMap((id) => [
            { payload: { path: ["reclamationId"], equals: id } },
            { idempotencyKey: { contains: id } },
          ]),
        },
      });
    }
    await db.reclamation.deleteMany({ where: { number: { startsWith: prefix } } });
    await db.order.deleteMany({ where: { number: { startsWith: prefix } } });
    await db.product.deleteMany({ where: { sku: { startsWith: prefix } } });
    await db.supplier.deleteMany({ where: { name: { startsWith: prefix } } });
    const admin = await db.adminUser.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true },
    });
    if (admin) {
      await db.auditLog.deleteMany({ where: { actorId: admin.id } });
      await db.adminUser.delete({ where: { id: admin.id } });
    }
    mutableReclamationId = "";
  }
});

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

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
  if (!raw) throw new Error("Database URL is required for reclamation analytics QA.");
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
