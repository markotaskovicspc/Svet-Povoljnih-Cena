import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import ExcelJS from "exceljs";

loadEnv({ path: ".env.local" });
loadEnv();

const expect = baseExpect.configure({ timeout: 30_000 });

test.describe("ERP module 4 purchase-order acceptance", () => {
  test.skip(
    process.env.E2E_PURCHASE_ORDERS !== "1",
    "Set E2E_PURCHASE_ORDERS=1 to run the isolated purchase-order suite.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.purchase.order.${runId}@example.invalid`,
    adminPassword: `QaPurchaseOrder!${runId}x`,
    supplierName: `QA PO dobavljač ${runId}`,
    supplierEmail: `qa.po.supplier.${runId}@example.invalid`,
    sku: `QA-PO-${runId}`.slice(0, 90),
    productName: `QA PO artikal ${runId}`,
    loadingName: `QA utovar ${runId}`,
    warehouseCode: `QA-PO-${runId}`.slice(0, 30),
    transportCode: `QA-PO-T-${runId}`.slice(0, 30),
  };

  let db: PrismaClient;
  let adminId = "";
  let supplierId = "";
  let productId = "";
  let warehouseId = "";
  let transportId = "";
  let loadingLocationId = "";
  let purchaseOrderId: string | null = null;
  const pageErrors: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash,
        role: "OPS",
        enabled: true,
        firstName: "QA",
        lastName: "Purchase order",
      },
      select: { id: true },
    });
    adminId = admin.id;
    const supplier = await db.supplier.create({
      data: {
        code: `QA-PO-${runId}`.slice(0, 80),
        name: fixture.supplierName,
        email: fixture.supplierEmail,
        currency: "EUR",
        parity: "DAP",
        paymentTerms: "30% avans, 70% pre utovara",
        deliveryDays: 21,
        transitDays: 4,
      },
      select: { id: true },
    });
    supplierId = supplier.id;
    const loadingLocation = await db.supplierLoadingLocation.create({
      data: {
        supplierId,
        name: fixture.loadingName,
        address: "Industrijska 1",
        city: "Beograd",
        country: "RS",
        position: 1,
      },
      select: { id: true },
    });
    loadingLocationId = loadingLocation.id;
    const warehouse = await db.warehouse.create({
      data: {
        code: fixture.warehouseCode,
        name: `QA PO magacin ${runId}`,
        active: true,
      },
      select: { id: true },
    });
    warehouseId = warehouse.id;
    const transport = await db.transportType.create({
      data: {
        code: fixture.transportCode,
        name: `QA mali transport ${runId}`,
        payloadKg: 50,
        payloadM3: 0.2,
      },
      select: { id: true },
    });
    transportId = transport.id;
    const product = await db.product.create({
      data: {
        sku: fixture.sku,
        slug: `qa-po-${runId}`,
        name: fixture.productName,
        description: "QA artikal za četvrti ERP modul",
        fullPrice: 3_600,
        supplierId,
        attribute1: "Masiv",
        colorPrimary: "Natur",
        packQty: 4,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
        packGrossWeightKg: 40,
        moq: 4,
        customsRate: 10,
        supplierProductName: `SUP-${runId}`,
        barcode: `860${runId.replace(/\D/g, "").slice(-10).padStart(10, "0")}`,
      },
      select: { id: true },
    });
    productId = product.id;
    await db.purchasePrice.create({
      data: {
        productId,
        supplierId,
        sku: fixture.sku,
        name: fixture.productName,
        attributes: "Masiv",
        pattern: "Natur",
        price: 10,
        currency: "EUR",
        parity: "DAP",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("real OPS admin completes create, validation, posting, export and send", async ({
    context,
    page,
  }) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(15_000);
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);

    await test.step("module 4 renders both required overviews and all header columns", async () => {
      await page.goto("/admin/erp/porudzbenice", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: "Porudžbenice" })).toBeVisible();
      for (const command of [
        "Kreiraj novu",
        "Pregled po artiklima",
        "Pošalji dobavljaču",
        "Proknjiži porudžbenicu",
        "Excel",
      ]) {
        await expect(page.getByRole("button", { name: command, exact: true }).or(
          page.getByRole("link", { name: command, exact: true }),
        )).toBeVisible();
      }
      for (const header of [
        "Broj porudžbenice",
        "Status",
        "Dobavljač",
        "Datum kreiranja",
        "Datum porudžbine",
        "Datum utovara",
        "Datum isporuke",
        "Ukupna zapremina",
        "Ukupna težina",
        "Ukupna cena",
        "Valuta",
        "Tip transporta",
        "Paritet",
        "Ukupna BM%",
      ]) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeAttached();
      }
    });

    await test.step("automatic sequence creates a dated draft and opens its detail", async () => {
      await page.getByRole("button", { name: "Kreiraj novu", exact: true }).click();
      await expect
        .poll(async () => {
          const audit = await db.auditLog.findFirst({
            where: {
              actorId: adminId,
              action: "erp.command.po.create",
              entity: "erp:porudzbenice",
            },
            orderBy: { createdAt: "desc" },
            select: { entityId: true },
          });
          return audit?.entityId ?? null;
        }, { timeout: 20_000 })
        .not.toBeNull();
      purchaseOrderId = (
        await db.auditLog.findFirstOrThrow({
          where: {
            actorId: adminId,
            action: "erp.command.po.create",
            entity: "erp:porudzbenice",
          },
          orderBy: { createdAt: "desc" },
          select: { entityId: true },
        })
      ).entityId;
      if (!purchaseOrderId) throw new Error("Purchase-order ID is missing.");
      await page.goto(`/admin/erp/porudzbenice/${purchaseOrderId}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const created = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId },
      });
      expect(created.number).toMatch(/^\d+\/\d{2}$/);
      expect(created.status).toBe("DRAFT");
      expect(created.orderDate).not.toBeNull();
    });

    await test.step("header saves controlled supplier, loading, transport, currency and dates", async () => {
      const header = page.locator("form").filter({
        has: page.getByRole("button", { name: "Sačuvaj zaglavlje" }),
      });
      await header.locator('[name="supplierId"]').selectOption(supplierId);
      await header.locator('[name="loadingLocationId"]').selectOption(loadingLocationId);
      await header.locator('[name="receivingWarehouseId"]').selectOption(warehouseId);
      await header.locator('[name="transportTypeId"]').selectOption(transportId);
      await header.locator('[name="orderDate"]').fill("2026-07-01");
      await header.locator('[name="loadingDate"]').fill("2026-07-10");
      await header.locator('[name="exchangeRate"]').fill("120");
      await header.locator('[name="freightCost"]').fill("100");
      await header.locator('[name="freightCurrency"]').selectOption("EUR");
      await header.locator('[name="freightExchangeRate"]').fill("120");
      await header.getByRole("button", { name: "Sačuvaj zaglavlje" }).click();
      await expect(header.getByRole("status")).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: /^Datum isporuke/ }),
      ).toHaveValue("2026-07-14");
      await expect(header.locator('[name="supplierId"]')).toHaveValue(supplierId);
      await expect(header.locator('[name="loadingLocationId"]')).toHaveValue(
        loadingLocationId,
      );
      await expect(header.locator('[name="receivingWarehouseId"]')).toHaveValue(
        warehouseId,
      );
      await expect(header.locator('[name="transportTypeId"]')).toHaveValue(
        transportId,
      );
      await expect(header.locator('[name="freightCurrency"]')).toHaveValue("EUR");
      const saved = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId! },
      });
      expect(saved.currency).toBe("EUR");
      expect(Number(saved.exchangeRate)).toBe(120);
      expect(saved.parity).toBe("DAP");
      expect(saved.deliveryDate?.toISOString().slice(0, 10)).toBe("2026-07-14");
    });

    await test.step("SKU lookup snapshots all article data and highlights an invalid package", async () => {
      const addForm = page.locator("form").filter({
        has: page.getByRole("button", { name: "Dodaj", exact: true }),
      });
      await addForm.locator('[name="sku"]').fill(fixture.sku.toLowerCase());
      await addForm.locator('[name="qty"]').fill("6");
      await addForm.getByRole("button", { name: "Dodaj", exact: true }).click();
      await expect(addForm.getByRole("status")).toBeVisible();
      const item = await db.purchaseOrderItem.findFirstOrThrow({
        where: { purchaseOrderId: purchaseOrderId! },
      });
      expect({
        productId: item.productId,
        sku: item.sku,
        purchasePrice: Number(item.purchasePrice),
        currency: item.currency,
        parity: item.parity,
        priceValidFrom: item.priceValidFrom?.toISOString().slice(0, 10),
        moq: item.moq,
        packQty: item.packQty,
        qty: item.qty,
        volume: Number(item.totalVolume),
        weight: Number(item.totalWeight),
        customsRate: Number(item.customsRate),
        calcRetailPrice: Number(item.calcRetailPrice),
        supplierProductName: item.supplierProductName,
        barcode: item.barcode,
      }).toEqual({
        productId,
        sku: fixture.sku,
        purchasePrice: 10,
        currency: "EUR",
        parity: "DAP",
        priceValidFrom: "2026-01-01",
        moq: 4,
        packQty: 4,
        qty: 6,
        volume: 0.3,
        weight: 60,
        customsRate: 10,
        calcRetailPrice: 3_600,
        supplierProductName: `SUP-${runId}`,
        barcode: expect.any(String),
      });
      await expect(page.getByText("Nije deljivo sa 4")).toBeVisible();
    });

    await test.step("server rejects wrong packs, capacity overflow and direct grid tampering", async () => {
      const itemsModule = await page.request.get(
        "/api/admin/erp/porudzbenice-po-artiklima/rows?page=1&pageSize=100",
      );
      expect(itemsModule.status()).toBe(200);
      const itemPayload = (await itemsModule.json()) as {
        rows: Array<{ id: string }>;
      };
      const itemId = itemPayload.rows.find((row) => row.id)?.id;
      expect(itemId).toBeTruthy();
      const invalidPack = await page.request.post(
        "/api/admin/erp/porudzbenice-po-artiklima/commands",
        { data: { action: "po-items.validate-packs", ids: [itemId] } },
      );
      expect(invalidPack.status()).toBe(400);
      expect(((await invalidPack.json()) as { error: string }).error).toContain(
        "nije deljiva",
      );
      const directEdit = await page.request.patch(
        `/api/admin/erp/porudzbenice/rows/${purchaseOrderId}`,
        { data: { columnKey: "totalPrice", value: 1 } },
      );
      expect(directEdit.status()).toBe(422);
      const postOverflow = await page.request.post(
        "/api/admin/erp/porudzbenice/commands",
        { data: { action: "po.post", ids: [purchaseOrderId] } },
      );
      expect(postOverflow.status()).toBe(400);
    });

    await test.step("line correction recomputes freight, customs, totals and BM", async () => {
      const quantity = page.getByLabel(`Količina ${fixture.sku}`);
      await quantity.fill("8");
      await page.getByLabel(`Nabavna cena ${fixture.sku}`).fill("11");
      await page.getByLabel(`Carinska stopa ${fixture.sku}`).fill("12");
      await page.getByLabel(`Kalkulativna MPC ${fixture.sku}`).fill("4000");
      await quantity.locator("xpath=ancestor::form").getByRole("button", { name: "Snimi" }).click();
      await expect(page.getByText("Nije deljivo sa 4")).toHaveCount(0);
      const item = await db.purchaseOrderItem.findFirstOrThrow({
        where: { purchaseOrderId: purchaseOrderId! },
      });
      const order = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId! },
      });
      expect(item.qty).toBe(8);
      expect(Number(item.totalVolume)).toBe(0.4);
      expect(Number(item.totalWeight)).toBe(80);
      expect(Number(item.freightAllocated)).toBe(12_000);
      expect(item.bmPct).not.toBeNull();
      expect(Number(order.totalPrice)).toBe(88);
      expect(order.bmPct).not.toBeNull();
    });

    await test.step("capacity warning clears and sending before posting locks the order date", async () => {
      await expect(page.getByText("Kapacitet transporta je prekoračen:")).toBeVisible();
      await db.transportType.update({
        where: { id: transportId },
        data: { payloadKg: 1_000, payloadM3: 10 },
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("Kapacitet transporta je prekoračen:")).toHaveCount(0);
      await page.getByRole("button", { name: "Pošalji dobavljaču" }).click();
      await expect
        .poll(async () =>
          (
            await db.purchaseOrder.findUniqueOrThrow({
              where: { id: purchaseOrderId! },
              select: { status: true },
            })
          ).status,
        )
        .toBe("SENT");
      const sent = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId! },
      });
      expect(sent.lockedAt).toBeNull();
      expect(sent.orderDate?.toISOString().slice(0, 10)).toBe(
        new Date().toISOString().slice(0, 10),
      );
      await expect(
        page.getByRole("textbox", { name: /^Datum porudžbenice/ }),
      ).toHaveAttribute("readonly");
      await expect(page.locator('select[name="status"]')).toHaveValue("SENT");
    });

    await test.step("posting locks all business fields", async () => {
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Proknjiži porudžbenicu" }).click();
      await expect(page.getByText(/poslovni podaci su zaključani/i)).toBeVisible();
      const posted = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId! },
      });
      expect(posted.lockedAt).not.toBeNull();
      expect(posted.postedAt).not.toBeNull();
      await expect(page.getByRole("button", { name: "Sačuvaj zaglavlje" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Dodaj", exact: true })).toHaveCount(0);
    });

    await test.step("PDF and Excel contain a complete single-order export", async () => {
      const pdf = await page.request.get(
        `/api/admin/purchase-orders/${purchaseOrderId}/pdf`,
      );
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      expect((await pdf.body()).subarray(0, 8).toString()).toBe("%PDF-1.4");

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: "Štampa Excel" }).click();
      const download = await downloadPromise;
      const excelPath = await download.path();
      if (!excelPath) throw new Error("Excel download did not produce a file.");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(excelPath);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        "Porudžbenica",
        "Artikli",
      ]);
      expect(workbook.getWorksheet("Artikli")?.getRow(2).values).toContain(
        fixture.sku,
      );
    });

    await test.step("resend writes exact subject, status and refreshed order date", async () => {
      const messageCount = await db.emailMessage.count({
        where: {
          kind: "purchase_order",
          recipient: fixture.supplierEmail,
        },
      });
      await page.getByRole("button", { name: "Pošalji dobavljaču" }).click();
      await expect
        .poll(() =>
          db.emailMessage.count({
            where: {
              kind: "purchase_order",
              recipient: fixture.supplierEmail,
            },
          }),
        )
        .toBe(messageCount + 1);
      const message = await db.emailMessage.findFirstOrThrow({
        where: {
          kind: "purchase_order",
          recipient: fixture.supplierEmail,
        },
        orderBy: { createdAt: "desc" },
      });
      const order = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId! },
      });
      expect(message.subject).toBe(`Order NO ${order.number}`);
      expect(message.status).toBe("SENT");
      expect(order.orderDate?.toISOString().slice(0, 10)).toBe(
        new Date().toISOString().slice(0, 10),
      );
    });

    await test.step("overview supports double click and complete row-level view", async () => {
      await page.goto("/admin/erp/porudzbenice", {
        waitUntil: "domcontentloaded",
      });
      const row = page.locator("tbody tr").filter({ hasText: fixture.supplierName });
      await expect(row).toHaveCount(1);
      await row.dblclick({ position: { x: 300, y: 20 } });
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/porudzbenice/${purchaseOrderId}$`),
      );
      await page.goto("/admin/erp/porudzbenice-po-artiklima", {
        waitUntil: "domcontentloaded",
      });
      for (const header of [
        "Broj porudžbenice",
        "Status",
        "Dobavljač (zaglavlje)",
        "Datum kreiranja",
        "Datum porudžbine",
        "Datum utovara",
        "Datum isporuke",
        "Valuta (zaglavlje)",
        "Tip transporta",
        "Paritet (zaglavlje)",
        "Šifra artikla",
        "Fotografija artikla",
        "Dobavljačev naziv artikla",
        "Sertifikati",
        "Bar kod",
      ]) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeAttached();
      }
      await expect(page.locator("tbody tr").filter({ hasText: fixture.sku })).toHaveCount(1);
    });

    expect(pageErrors).toEqual([]);
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  }

  async function cleanup() {
    if (!db) return;
    const auditedPurchaseOrderIds = adminId
      ? (
          await db.auditLog.findMany({
            where: {
              actorId: adminId,
              action: "erp.command.po.create",
              entityId: { not: null },
            },
            select: { entityId: true },
          })
        )
          .map((entry) => entry.entityId)
          .filter((id): id is string => Boolean(id))
      : [];
    const purchaseOrderIds = [
      ...auditedPurchaseOrderIds,
      ...(purchaseOrderId ? [purchaseOrderId] : []),
    ];
    if (purchaseOrderIds.length) {
      await db.purchaseOrder.deleteMany({
        where: { id: { in: purchaseOrderIds } },
      });
    }
    await db.emailMessage.deleteMany({
      where: { recipient: fixture.supplierEmail },
    });
    if (productId) {
      await db.purchasePrice.deleteMany({ where: { productId } });
      await db.product.deleteMany({ where: { id: productId } });
    }
    if (loadingLocationId) {
      await db.supplierLoadingLocation.deleteMany({
        where: { id: loadingLocationId },
      });
    }
    if (supplierId) await db.supplier.deleteMany({ where: { id: supplierId } });
    if (transportId) {
      await db.transportType.deleteMany({ where: { id: transportId } });
    }
    if (warehouseId) await db.warehouse.deleteMany({ where: { id: warehouseId } });
    if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
  }
});

function createDatabaseClient() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for purchase-order acceptance.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      max: 2,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
