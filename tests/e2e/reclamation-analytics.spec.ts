// Acceptance: DASH-01
// Acceptance: SERVICE-01
// Acceptance: REPORT-01
// Acceptance: REPORT-02
// Acceptance: REPORT-03
// Acceptance: REPORT-04
// Acceptance: REPORT-05
// Acceptance: ANALYTICS-01
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
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
    cancelledOrder: `${prefix}-OTKAZANO`.slice(0, 80),
  };

  let db: PrismaClient;
  let mutableReclamationId = "";
  let createdWarehouseId = "";

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

    const warehouse = await db.warehouse.create({
      data: {
        code: `QA-REK-DC-${runId}`.slice(0, 40),
        name: `${prefix} DC`,
        active: true,
        isDefault: false,
      },
      select: { id: true },
    });
    createdWarehouseId = warehouse.id;
    await Promise.all([
      db.product.update({
        where: { id: productA.id },
        data: {
          palletQty: 40,
          packQty: 1,
          packWidthCm: 100,
          packDepthCm: 100,
          packHeightCm: 100,
        },
      }),
      db.warehouseStock.createMany({
        data: [
          { warehouseId: warehouse.id, productId: productA.id, qty: 81 },
          { warehouseId: warehouse.id, productId: productC.id, qty: 5 },
        ],
      }),
    ]);

    const deliveredOrder = await db.order.create({
      data: {
        ...orderData(fixture.deliveredOrder, "ISPORUCENO"),
        items: {
          create: [
            orderItemData(productA, fixture.supplierA, 100, warehouse.id),
            orderItemData(productB, fixture.supplierB, 50, warehouse.id),
            orderItemData(productC, fixture.supplierA, 20, warehouse.id),
          ],
        },
      },
      include: { items: true },
    });
    const activeOrder = await db.order.create({
      data: {
        ...orderData(fixture.activeOrder, "U_ISPORUCI"),
        items: {
          create: orderItemData(productA, fixture.supplierA, 900, warehouse.id),
        },
      },
      include: { items: true },
    });
    await db.order.create({
      data: {
        ...orderData(fixture.cancelledOrder, "OTKAZANO"),
        items: {
          create: orderItemData(productA, fixture.supplierA, 2_000, warehouse.id),
        },
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

    await Promise.all([
      createFiscalSale({
        orderId: deliveredOrder.id,
        item: itemA,
        warehouseId: warehouse.id,
        suffix: "SALE-A",
        qty: 2,
        totalGross: 2_500,
        serviceGross: 500,
      }),
      createFiscalSale({
        orderId: activeOrder.id,
        item: activeOrder.items[0]!,
        warehouseId: warehouse.id,
        suffix: "SALE-B",
        qty: 1,
        totalGross: 1_000,
        serviceGross: 0,
      }),
      db.fiscalDocument.create({
        data: {
          orderId: deliveredOrder.id,
          kind: "REFUND",
          status: "ISSUED",
          source: "MANUAL",
          warehouseId: warehouse.id,
          receiptNumber: `${prefix}-REFUND-A`,
          idempotencyKey: `${prefix}:fiscal:refund-a`,
          totalNet: 500 / 1.2,
          totalVat: 500 - 500 / 1.2,
          totalGross: 500,
          issuedAt: new Date(),
        },
      }),
      db.shipment.create({
        data: {
          orderId: deliveredOrder.id,
          warehouseId: warehouse.id,
          service: "COURIER_SMALL",
          purpose: "ORDER_DELIVERY",
          status: "DELIVERED",
          deliveredAt: new Date(),
        },
      }),
      db.analyticsEvent.createMany({
        data: [
          analyticsEvent("PAGE_VIEW", "anon-a", { sessionId: `${prefix}-session-a` }),
          analyticsEvent("PAGE_VIEW", "anon-b", { sessionId: `${prefix}-session-b` }),
          analyticsEvent("PRODUCT_VIEW", "anon-a", { productId: productA.id }),
          analyticsEvent("ADD_TO_CART", "anon-a", {
            productId: productA.id,
            quantity: 2,
          }),
          analyticsEvent("CHECKOUT_COMPLETED", "anon-a", {
            orderId: deliveredOrder.id,
            value: 2_500,
          }),
        ],
      }),
    ]);
  }, 120_000);

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
      await page.goto("/admin/erp/reklamacije-dnevnik", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/admin\/prijava/);
      await login(page);
      await expect(page).toHaveURL(/\/admin\/erp\/reklamacije-dnevnik$/);
      const pageHeading = page.getByRole("heading", {
        name: "Reklamacije",
        exact: true,
      });
      await expect(pageHeading).toHaveCount(1);
      await expect(pageHeading).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Obrada reklamacija" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Reklamacije – izveštaji" }).click();
      await expect(page).toHaveURL(/\/admin\/erp\/reklamacije-izvestaji$/);
    });

    await test.step("sve sekcije zahteva su prikazane", async () => {
      for (const heading of [
        "Ukupni pokazatelji",
        "Reklamacije po tipu",
        "Reklamacije po načinu rešavanja",
        "Isti pokazatelji po dobavljaču",
        "Top 20 artikala sa najviše reklamacija",
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
      const countRanking = page.locator('[data-reclamation-ranking="count"]');
      const productRow = countRanking.locator("tbody tr").filter({
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
      await expect(
        page.getByRole("heading", {
          name: "Top 20 artikala po procentu reklamacija",
        }),
      ).toBeVisible();
    });

    await test.step("status filter utiče samo na operativni spisak", async () => {
      await page.goto("/admin/erp/reklamacije-dnevnik", {
        waitUntil: "domcontentloaded",
      });
      await page.locator('a[href="/admin/erp/reklamacije-dnevnik?status=RESENO"]').click();
      await expect(page).toHaveURL(/status=RESENO/);
      const operations = page.locator(
        'section[aria-labelledby="reclamation-operations"]',
      );
      await expect(operations.getByText(`${prefix}-A-RESENO`, { exact: true })).toBeVisible();
      await expect(operations.getByText(`${prefix}-B-RESENO`, { exact: true })).toBeVisible();
      await expect(
        operations.getByText(`${prefix}-A-OPEN-31`, { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Reklamacije – izveštaji" }),
      ).toBeVisible();
    });

    await test.step("postojeća promena statusa i istorija nisu pokvarene", async () => {
      await page.goto("/admin/erp/reklamacije-dnevnik?status=PRIMLJENO", {
        waitUntil: "domcontentloaded",
      });
      const operations = page.locator(
        'section[aria-labelledby="reclamation-operations"]',
      );
      const card = operations.locator("div.rounded-2xl").filter({
        hasText: `${prefix}-A-OPEN-31`,
      });
      await expect(card).toHaveCount(1);
      await card
        .getByRole("link", { name: "Otvori detalj i obradu", exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/reklamacije-dnevnik/${mutableReclamationId}$`),
      );
      await page.locator('select[name="status"]').selectOption("U_OBRADI");
      await page.locator('textarea[name="note"]').fill("QA provera analitike");
      await page
        .getByRole("button", { name: "Promeni status", exact: true })
        .click();
      await expect
        .poll(async () =>
          db.reclamation.findUnique({
            where: { id: mutableReclamationId },
            select: { status: true },
          }),
        )
        .toEqual({ status: "U_OBRADI" });
      await page.goto("/admin/erp/reklamacije-dnevnik?status=U_OBRADI", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page
          .locator('section[aria-labelledby="reclamation-operations"]')
          .getByText(`${prefix}-A-OPEN-31`, { exact: true }),
      ).toBeVisible();
    });

    await test.step("dashboard periodi, podrazumevani pogledi i XLSX izvozi rade", async () => {
      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Kontrolna tabla" })).toBeVisible();
      for (const label of [
        "Porudžbine period",
        "Fiskalni promet period",
        "Reklamacije period",
        "Top proizvodi period",
        "Posete i konverzije period",
      ]) {
        await expect(page.getByLabel(label)).toBeVisible();
      }
      for (const label of [
        "Porudžbine danas",
        "Porudžbine u periodu",
        "Promet danas (neto fiskalizovano)",
        "Promet u periodu (neto fiskalizovano)",
        "Reklamacije u periodu",
        "Ukupne zalihe po COGS-u",
        "Roba u dolasku",
        "Trenutni broj poseta",
        "Današnji broj poseta",
        "Prosečan dnevni broj poseta",
        "Poseta → kupovina",
        "Poseta → vrednost",
        "Korpa → kupovina",
      ]) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      const kpiSection = page.locator('section[aria-label="Ključni pokazatelji"]');
      await expect(kpiSection).toBeVisible();
      await expect(
        kpiSection.getByText("Trenutni broj poseta", { exact: true }),
      ).toBeVisible();
      await expect(
        kpiSection.getByText("Prosečan dnevni broj poseta", { exact: true }),
      ).toBeVisible();
      await expect(kpiSection.getByRole("heading", { name: "Zalihe za magacin" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Zalihe za magacin" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Top proizvodi" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Niske zalihe" })).toBeVisible();
      await expect(page.getByText("Otvorene operacije", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Status feed-a" })).toHaveCount(0);

      const viewName = `${prefix} dashboard`;
      const dashboardDate = belgradeDateInput(new Date());
      const baseView = {
        module: "dashboard",
        name: viewName,
        query: "",
        filters: [],
        sorting: [],
        visibleColumns: [],
        columnOrder: [],
        columnWidths: {},
        isDefault: true,
        context: {
          warehouseId: createdWarehouseId,
          ordersRange: "custom",
          ordersFrom: dashboardDate,
          ordersTo: dashboardDate,
          fiscalRange: "custom",
          fiscalFrom: dashboardDate,
          fiscalTo: dashboardDate,
          reclamationsRange: "custom",
          reclamationsFrom: dashboardDate,
          reclamationsTo: dashboardDate,
          topProductsRange: "custom",
          topProductsFrom: dashboardDate,
          topProductsTo: dashboardDate,
          analyticsRange: "custom",
          analyticsFrom: dashboardDate,
          analyticsTo: dashboardDate,
        },
      };
      const rejectedView = await page.request.post("/api/admin/saved-views", {
        data: { ...baseView, name: `${viewName} invalid`, context: { root: "/tmp" } },
      });
      expect(rejectedView.status()).toBe(400);

      for (const name of [
        "orders",
        "fiscal",
        "reclamations",
        "topProducts",
        "analytics",
      ]) {
        await page.locator(`select[name="${name}Range"]`).selectOption("custom");
      }
      await page.locator('select[name="warehouseId"]').selectOption(createdWarehouseId);
      for (const [key, value] of Object.entries(baseView.context)) {
        if (key === "warehouseId" || key.endsWith("Range")) continue;
        await page.locator(`input[name="${key}"]`).fill(value);
      }
      await page.getByRole("button", { name: "Primeni filtere" }).click();
      await expect(page).toHaveURL(new RegExp(`ordersFrom=${dashboardDate}`));
      await expect(page.locator('[data-client-ready="true"]')).toBeVisible();
      await expect(
        page.getByText("Porudžbine danas", { exact: true }).locator(".."),
      ).toContainText("3");
      await expect(
        page.getByText("Promet danas (neto fiskalizovano)", { exact: true }).locator(".."),
      ).toContainText("3.000 RSD");
      const palletCard = page
        .getByText("Zauzeta paletna mesta", { exact: true })
        .locator("..");
      await expect(palletCard).toContainText("3");
      await expect(palletCard).toContainText("1 SKU bez podatka kom/paleta");
      const warehouseStockRow = page.getByRole("row").filter({
        hasText: `${prefix} DC`,
      });
      await expect(warehouseStockRow).toContainText("81 m³");
      await expect(
        page.getByText(
          "Zapremina koristi 69 m³ ÷ komada u kontejneru; ako taj podatak ne postoji, koristi Š × D × V transportnog pakovanja ÷ 1.000.000 ÷ komada u paketu.",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Paletna mesta = zbir zaokruženog naviše odnosa stanje ÷ komada na paleti, zasebno po SKU-u.",
          { exact: false },
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Sačuvaj pogled" }).click();
      await page.getByLabel("Naziv dashboard pogleda").fill(viewName);
      await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        `Pogled „${viewName}” je sačuvan kao podrazumevani.`,
      );

      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-client-ready="true"]')).toBeVisible();
      await expect(page.locator('select[name="ordersRange"]')).toHaveValue("custom");
      await expect(page.getByLabel("Porudžbine od")).toHaveValue(dashboardDate);
      await expect(page.locator('select[name="warehouseId"]')).toHaveValue(createdWarehouseId);

      const listedViews = await page.request.get(
        "/api/admin/saved-views?module=dashboard",
      );
      expect(listedViews.ok()).toBe(true);
      const listedPayload = (await listedViews.json()) as {
        views: Array<{
          id: string;
          name: string;
          isDefault: boolean;
          context: Record<string, string>;
        }>;
      };
      const savedPayload = listedPayload.views.find((view) => view.name === viewName);
      expect(savedPayload?.context).toEqual(baseView.context);
      expect(savedPayload?.isDefault).toBe(true);

      await page
        .getByRole("button", { name: `Obriši pogled ${viewName}` })
        .click();
      await page
        .getByRole("button", { name: `Potvrdi brisanje ${viewName}` })
        .click();
      await expect(page.getByRole("status")).toContainText(
        `Podrazumevani pogled „${viewName}” je obrisan.`,
      );

      await assertWorkbookContains(
        await page.request.get(
          `/api/admin/erp/prodajni-nalozi/export?from=${dashboardDate}&to=${dashboardDate}&warehouseId=${createdWarehouseId}`,
        ),
        "Fiskalizovano",
        fixture.cancelledOrder,
      );

      await assertWorkbookContains(
        await page.request.get(
          `/api/admin/erp/prodajni-nalozi/export?from=${dashboardDate}&to=${dashboardDate}&dateField=fiscal-issued-at&fiscalStatus=issued&warehouseId=${createdWarehouseId}`,
        ),
        "Broj porudžbine",
        fixture.deliveredOrder,
      );
    });

    await test.step("Izveštajni centar ne duplira dashboard i vodi na namenske ekrane", async () => {
      await page.goto("/admin/izvestaji", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: "Izveštajni centar" })).toBeVisible();
      const reportsHub = page.locator('nav[aria-label="Dostupni namenski izveštaji"]');
      for (const link of [
        "Dnevni promet",
        "Knjigovodstveni izveštaji",
        "Posete i konverzije",
        "QA objave",
        "Audit log",
      ]) {
        await expect(reportsHub.getByRole("link", { name: new RegExp(link) })).toBeVisible();
      }
      for (const duplicate of ["Roba u dolasku", "Reklamacije u periodu", "Ukupne zalihe po COGS-u"]) {
        await expect(page.getByText(duplicate, { exact: true })).toHaveCount(0);
      }

      await page.goto("/admin/erp/posete-konverzije", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", {
          name: "Posete i konverzije",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Top 50 proizvoda" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Korpa po kupcu i artiklu" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Raw drilldown" })).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Posete i konverzije po stranici",
        }),
      ).toBeVisible();
      await expect(page.getByText(fixture.skuA, { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText("Poseta → kupovina", { exact: true }).locator(".."),
      ).toContainText("%");

      const analyticsExport = await page.request.get(
        "/api/admin/analytics/conversions/export?range=30d&group=week",
      );
      await assertWorkbookContains(analyticsExport, "Jedinstvene posete", "/");

      await page.goto("/admin/erp/dnevni-promet", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", {
          name: "Dnevni zbir profaktura i fiskalizacije",
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Neto fiskalizovano", { exact: true }).first(),
      ).toBeVisible();
      const dailyExport = await page.request.get(
        "/api/admin/reports/daily-finance/export?range=30d",
      );
      await assertWorkbookContains(dailyExport, "Fiskalizovano", "UKUPNO");
    });

    await test.step("stara nefiskalizovana porudžbina ostaje dostupna za ručnu fiskalizaciju", async () => {
      const product = await db.product.findUniqueOrThrow({
        where: { sku: fixture.skuC },
      });
      const oldOrderNumber = `${prefix}-STARA-FISKAL`.slice(0, 80);
      await db.order.create({
        data: {
          ...orderData(oldOrderNumber, "U_ISPORUCI"),
          createdAt: new Date("2025-01-01T10:00:00.000Z"),
          items: {
            create: orderItemData(product, fixture.supplierA, 1, createdWarehouseId),
          },
        },
      });
      await db.order.createMany({
        data: Array.from({ length: 85 }, (_, index) => ({
          ...orderData(`${prefix}-NOVIJA-${index}`.slice(0, 80), "U_ISPORUCI"),
          createdAt: new Date(Date.now() + index * 1_000),
        })),
      });

      await page.goto("/admin/fiskalizacija", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Ručna fiskalizacija" }).click();
      const dialog = page.getByRole("dialog", { name: "Ručna fiskalizacija" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog
          .getByRole("combobox", { name: "Porudžbina" })
          .locator("option")
          .filter({ hasText: oldOrderNumber }),
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
    });

    await test.step("operater ručno evidentira reklamaciju bez obzira na status porudžbine", async () => {
      await page.goto("/admin/erp/reklamacije-dnevnik", {
        waitUntil: "domcontentloaded",
      });

      await page
        .getByText("+ Ručno evidentiraj reklamaciju", { exact: false })
        .click();
      const form = page.getByTestId("manual-reclamation-form");
      await expect(form).toBeVisible();
      const orderSearch = form.getByRole("combobox", {
        name: "Broj porudžbine ili fiskalnog računa",
      });
      const skuSelect = form.locator('select[name="sku"]');
      await orderSearch.fill(fixture.cancelledOrder);
      await form
        .getByRole("option", { name: new RegExp(fixture.cancelledOrder) })
        .click();
      await expect(skuSelect).toBeEnabled();
      const description = `${prefix} ručni unos reklamacije otkazane porudžbine`;
      await skuSelect.selectOption(fixture.skuA);
      await form.locator('input[name="quantity"]').fill("1");
      await form.locator('select[name="type"]').selectOption("KVAR");
      await form.locator('select[name="request"]').selectOption("ZAMENA");
      await form.locator('textarea[name="description"]').fill(description);
      await form.getByRole("button", { name: "Evidentiraj reklamaciju" }).click();

      await expect(form.getByRole("status")).toContainText(
        /Reklamacija .+ je ručno evidentirana\./,
        { timeout: 30_000 },
      );
      await expect
        .poll(() =>
          db.reclamation.findFirst({
            where: { description },
            include: { events: true },
          }),
        )
        .not.toBeNull();
      const saved = await db.reclamation.findFirstOrThrow({
        where: { description },
        include: { events: true },
      });
      expect(saved).toMatchObject({
        type: "KVAR",
        request: "ZAMENA",
      });
      expect(saved.orderId).toBe(
        (
          await db.order.findUniqueOrThrow({
            where: { number: fixture.cancelledOrder },
            select: { id: true },
          })
        ).id,
      );
      expect(
        saved.events.some(
          (event) =>
            event.actorId &&
            event.note === "Reklamacija ručno uneta u administraciji",
        ),
      ).toBe(true);
      await db.reclamation.delete({ where: { id: saved.id } });
    });

    await test.step("mobilni prikaz nema horizontalni overflow stranice", async () => {
      if (test.info().project.name !== "mobile") return;
      await page.goto("/admin/erp/reklamacije-dnevnik", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("button", { name: "Otvori meni" })).toBeVisible();
      await page.getByRole("button", { name: "Otvori meni" }).click();
      const menuScroll = page.getByTestId("admin-mobile-nav-scroll");
      await expect(menuScroll).toBeVisible();
      expect(
        await menuScroll.evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          hasOverflow: element.scrollHeight > element.clientHeight,
        })),
      ).toEqual({ overflowY: "auto", hasOverflow: true });
      const lastMenuLink = menuScroll.getByRole("link", { name: "Audit log" });
      await lastMenuLink.scrollIntoViewIfNeeded();
      await expect(lastMenuLink).toBeVisible();
      await page.keyboard.press("Escape");
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

    const unexpectedRuntimeErrors = runtimeErrors.filter(
      (message) =>
        !(
          message.includes("ClientFetchError") &&
          message.includes("Failed to fetch")
        ),
    );
    expect(unexpectedRuntimeErrors).toEqual([]);
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
    await expect(page).toHaveURL(/\/admin\/erp\/reklamacije-dnevnik$/, {
      timeout: 30_000,
    });
  }

  function orderData(
    number: string,
    status: "ISPORUCENO" | "U_ISPORUCI" | "OTKAZANO",
  ) {
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
    warehouseId: string,
  ) {
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      supplierName,
      qty,
      unitPriceFull: 1_000,
      unitPriceSale: 1_000,
      warehouseId,
    };
  }

  async function createFiscalSale(input: {
    orderId: string;
    item: { id: string; productId: string | null; sku: string; name: string };
    warehouseId: string;
    suffix: string;
    qty: number;
    totalGross: number;
    serviceGross: number;
  }) {
    const document = await db.fiscalDocument.create({
      data: {
        orderId: input.orderId,
        kind: "SALE",
        status: "ISSUED",
        source: "MANUAL",
        warehouseId: input.warehouseId,
        receiptNumber: `${prefix}-${input.suffix}`,
        idempotencyKey: `${prefix}:fiscal:${input.suffix}`,
        totalNet: input.totalGross / 1.2,
        totalVat: input.totalGross - input.totalGross / 1.2,
        totalGross: input.totalGross,
        issuedAt: new Date(),
      },
    });
    const line = await db.fiscalDocumentLine.create({
      data: {
        fiscalDocument: { connect: { id: document.id } },
        orderItem: { connect: { id: input.item.id } },
        ...(input.item.productId
          ? { product: { connect: { id: input.item.productId } } }
          : {}),
        orderNumber: input.orderId,
        customerName: "QA Kupac",
        address: "Test 1",
        city: "Beograd",
        postalCode: "11000",
        phone: "+381600000000",
        email: `kupac.${runId}@example.invalid`,
        sku: input.item.sku,
        shortName: input.item.name,
        qty: input.qty,
        vatRate: 20,
        unitPriceGross: input.totalGross / input.qty,
        totalNet: input.totalGross / 1.2,
        totalVat: input.totalGross - input.totalGross / 1.2,
        totalGross: input.totalGross,
      },
    });
    await db.$executeRaw`
      UPDATE "FiscalDocumentLine"
      SET "unitCogs" = 400, "serviceGross" = ${input.serviceGross}
      WHERE id = ${line.id}
    `;
    return document;
  }

  function analyticsEvent(
    type:
      | "PAGE_VIEW"
      | "PRODUCT_VIEW"
      | "ADD_TO_CART"
      | "CHECKOUT_COMPLETED",
    identity: string,
    extra: {
      sessionId?: string;
      productId?: string;
      orderId?: string;
      quantity?: number;
      value?: number;
    },
  ) {
    return {
      type,
      anonymousId: `${prefix}-${identity}`,
      consentVersion: "qa-e2e",
      occurredAt: new Date(),
      expiresAt: new Date(Date.now() + 31 * DAY_MS),
      ...extra,
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
      warehouseId: createdWarehouseId,
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
    await db.analyticsEvent.deleteMany({
      where: { anonymousId: { startsWith: prefix } },
    });
    const fixtureOrders = await db.order.findMany({
      where: { number: { startsWith: prefix } },
      select: { id: true },
    });
    const fixtureOrderIds = fixtureOrders.map(({ id }) => id);
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
    await db.reclamation.deleteMany({
      where: {
        OR: [
          { number: { startsWith: prefix } },
          ...(fixtureOrderIds.length ? [{ orderId: { in: fixtureOrderIds } }] : []),
        ],
      },
    });
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
    if (createdWarehouseId) {
      await db.warehouse.deleteMany({ where: { id: createdWarehouseId } });
    }
    mutableReclamationId = "";
    createdWarehouseId = "";
  }
});

async function assertWorkbookContains(
  response: APIResponse,
  expectedHeader: string,
  expectedCell: string,
) {
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await response.body()) as never);
  const sheet = workbook.worksheets.find((candidate) =>
    (candidate.getRow(1).values as unknown[])
      .map(String)
      .includes(expectedHeader),
  );
  expect(sheet, `Nedostaje kolona ${expectedHeader} u XLSX-u`).toBeDefined();
  expect(
    sheet!
      .getRows(2, Math.max(sheet!.rowCount - 1, 0))
      ?.some((row) => row.values.some((cell) => String(cell) === expectedCell)),
  ).toBe(true);
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function belgradeDateInput(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
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
