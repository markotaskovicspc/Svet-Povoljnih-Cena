// Acceptance: COGS-01
// Acceptance: COGS-02
// Acceptance: ACC-04
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const expect = baseExpect.configure({ timeout: 30_000 });

test.describe("ERP module 5 inbound-invoice acceptance", () => {
  test.skip(
    process.env.E2E_INBOUND_INVOICES !== "1",
    "Set E2E_INBOUND_INVOICES=1 to run the isolated inbound-invoice suite.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.inbound.invoice.${runId}@example.invalid`,
    adminPassword: `QaInboundInvoice!${runId}x`,
    supplierName: `QA UF dobavljač ${runId}`,
    sku: `QA-UF-${runId}`.slice(0, 90),
    productName: `QA UF artikal ${runId}`,
    warehouseCode: `QA-UF-${runId}`.slice(0, 30),
    orderNumber: `QA-UF-PO-${runId}`,
    invoiceNumber: `QA-UF-INV-${runId}`,
  };

  let db: PrismaClient;
  let adminId = "";
  let supplierId = "";
  let productId = "";
  let warehouseId = "";
  let purchaseOrderId = "";
  let invoiceId = "";
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
        lastName: "Inbound invoice",
      },
      select: { id: true },
    });
    adminId = admin.id;

    const supplier = await db.supplier.create({
      data: {
        code: `QA-UF-${runId}`.slice(0, 80),
        name: fixture.supplierName,
        currency: "RSD",
        parity: "DAP",
      },
      select: { id: true },
    });
    supplierId = supplier.id;

    const warehouse = await db.warehouse.create({
      data: {
        code: fixture.warehouseCode,
        name: `QA UF magacin ${runId}`,
        active: true,
      },
      select: { id: true },
    });
    warehouseId = warehouse.id;

    const product = await db.product.create({
      data: {
        sku: fixture.sku,
        slug: `qa-uf-${runId}`,
        name: fixture.productName,
        description: "QA artikal za peti ERP modul",
        fullPrice: 1_000,
        stock: 100,
        cogs: 200,
        supplierId,
      },
      select: { id: true },
    });
    productId = product.id;
    await db.warehouseStock.create({
      data: { warehouseId, productId, qty: 100 },
    });

    const order = await db.purchaseOrder.create({
      data: {
        number: fixture.orderNumber,
        status: "CONFIRMED",
        supplierId,
        receivingWarehouseId: warehouseId,
        orderDate: new Date("2026-07-20T00:00:00.000Z"),
        totalPrice: 8_500,
        currency: "RSD",
        exchangeRate: 1,
        freightCost: 0,
        freightCurrency: "RSD",
        freightExchangeRate: 1,
        allocationBasis: "VALUE",
        lockedAt: new Date(),
        postedAt: new Date(),
        items: {
          create: {
            productId,
            sku: fixture.sku,
            name: fixture.productName,
            purchasePrice: 170,
            currency: "RSD",
            qty: 50,
            receivedQty: 0,
            customsRate: 0,
            freightAllocated: 0,
          },
        },
      },
      select: { id: true },
    });
    purchaseOrderId = order.id;
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("OPS admin creates, edits, opens, locks and receives a COGS invoice", async ({
    context,
    page,
  }) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);

    await test.step("module 5 renders the requested commands and overview", async () => {
      await page.goto("/admin/erp/ulazne-fakture", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "Ulazne fakture" }),
      ).toBeVisible();
      for (const command of ["Nova", "Uredi", "Zaključaj", "Storniraj", "Excel"]) {
        await expect(
          page.getByRole("button", { name: command, exact: true }),
        ).toBeVisible();
      }
      for (const header of [
        "Broj fakture",
        "Datum prijema",
        "Naziv dobavljača",
        "Vrednost fakture u RSD",
        "Vrednost carine u RSD",
        "Vrednost transporta u RSD",
        "Ostali vezani troškovi u RSD",
        "Ukupno bez PDV-a",
        "PDV (20%)",
        "Ukupno sa PDV-om",
        "Veza sa dokumentom",
      ]) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeAttached();
      }
    });

    await test.step("Nova opens an editable individual invoice", async () => {
      await page.getByRole("button", { name: "Nova", exact: true }).click();
      await expect(page).toHaveURL(
        /\/admin\/erp\/ulazne-fakture\/[^?]+\?mode=edit$/,
      );
      await expect(
        page.locator("header").getByRole("button", {
          name: "Nova",
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        page
          .locator("header")
          .getByRole("button", { name: "Nova", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Završi uređivanje", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Zaključaj", exact: true }),
      ).toBeVisible();
      invoiceId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      expect(invoiceId).not.toBe("");
    });

    await test.step("admin enters and saves the invoice values", async () => {
      const form = page.locator("form").filter({
        has: page.getByRole("button", { name: "Sačuvaj", exact: true }),
      });
      await form.locator('[name="number"]').fill(fixture.invoiceNumber);
      await form.locator('[name="receiptDate"]').fill("2026-07-24");
      await form
        .locator('[name="purchaseOrderId"]')
        .selectOption(purchaseOrderId);
      await expect(form.locator('[name="supplierId"]')).toHaveValue(supplierId);
      await expect(form.locator('[name="type"]')).toHaveValue("COGS");
      await expect(form.locator('[name="currency"]')).toHaveValue("RSD");
      await expect(form.locator('[name="exchangeRate"]')).toHaveValue("1");
      await expect(form.locator('[name="invoiceValueRsd"]')).toHaveValue("8500");
      await expect(form.locator('[name="customsValueRsd"]')).toHaveValue("0");
      await expect(form.locator('[name="transportValueRsd"]')).toHaveValue("0");
      await expect(form.locator('[name="otherRelatedCostsRsd"]')).toHaveValue(
        "0",
      );
      await expect(
        form.locator('[name="otherRelatedCostsRsd"]'),
      ).toHaveAttribute("readonly", "");
      await expect(form.locator('[name="netValue"]')).toHaveValue("8500");
      await expect(form.locator('[name="vatValue"]')).toHaveValue("1700");
      await expect(form.locator('[name="grossValue"]')).toHaveValue("10200");
      await form.locator('[name="notes"]').fill("QA trošak transporta");
      await form.getByRole("button", { name: "Sačuvaj", exact: true }).click();
      await expect(form.getByRole("status")).toContainText(
        "Ulazna faktura je sačuvana",
      );

      const saved = await db.inboundInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      expect({
        number: saved.number,
        supplierId: saved.supplierId,
        purchaseOrderId: saved.purchaseOrderId,
        type: saved.type,
        status: saved.status,
        net: Number(saved.netValue),
        vat: Number(saved.vatValue),
        gross: Number(saved.grossValue),
        invoiceValueRsd: Number(saved.invoiceValueRsd),
        customsValueRsd: Number(saved.customsValueRsd),
        transportValueRsd: Number(saved.transportValueRsd),
        otherRelatedCostsRsd: Number(saved.otherRelatedCostsRsd),
      }).toEqual({
        number: fixture.invoiceNumber,
        supplierId,
        purchaseOrderId,
        type: "COGS",
        status: "RECEIVED",
        net: 8_500,
        vat: 1_700,
        gross: 10_200,
        invoiceValueRsd: 8_500,
        customsValueRsd: 0,
        transportValueRsd: 0,
        otherRelatedCostsRsd: 0,
      });
      await expect(
        page.locator("tbody tr").filter({ hasText: fixture.sku }),
      ).toContainText("170");
    });

    await test.step("double click opens the invoice and Uredi persists a change", async () => {
      await page.goto("/admin/erp/ulazne-fakture", {
        waitUntil: "domcontentloaded",
      });
      const row = page.locator("tbody tr").filter({
        hasText: fixture.invoiceNumber,
      });
      await expect(row).toHaveCount(1);
      await row.getByText(fixture.invoiceNumber, { exact: true }).dblclick();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/ulazne-fakture/${invoiceId}$`),
      );
      const editLink = page
        .locator("header")
        .getByRole("link", { name: "Uredi", exact: true });
      await expect(editLink).toHaveCount(1);
      await page
        .locator("header")
        .getByRole("link", { name: "Uredi", exact: true })
        .click();
      const editForm = page.locator("form").filter({
        has: page.getByRole("button", { name: "Sačuvaj", exact: true }),
      });
      await editForm
        .locator('[name="notes"]')
        .fill("QA trošak transporta i špedicije");
      await editForm
        .getByRole("button", { name: "Sačuvaj", exact: true })
        .click();
      await expect(editForm.getByRole("status")).toBeVisible();
      await expect
        .poll(async () =>
          (
            await db.inboundInvoice.findUniqueOrThrow({
              where: { id: invoiceId },
              select: { notes: true },
            })
          ).notes,
        )
        .toBe("QA trošak transporta i špedicije");
    });

    await test.step("Zaključaj is idempotent and allocates the invoice once", async () => {
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Zaključaj", exact: true }).click();
      await expect(
        page.getByText(/Faktura je zaključana\. Troškovi su raspoređeni/),
      ).toBeVisible();
      const [locked, item] = await Promise.all([
        db.inboundInvoice.findUniqueOrThrow({ where: { id: invoiceId } }),
        db.purchaseOrderItem.findFirstOrThrow({
          where: { purchaseOrderId },
        }),
      ]);
      expect(locked.status).toBe("POSTED");
      expect(locked.cogsStatus).toBe("LOCKED");
      expect(locked.lockedAt).not.toBeNull();
      expect(Number(item.additionalCostAllocated)).toBe(0);

      const retry = await page.request.post(
        "/api/admin/erp/ulazne-fakture/commands",
        { data: { action: "invoice.lock", ids: [invoiceId] } },
      );
      expect(retry.status()).toBe(200);
      expect(
        Number(
          (
            await db.purchaseOrderItem.findFirstOrThrow({
              where: { purchaseOrderId },
              select: { additionalCostAllocated: true },
            })
          ).additionalCostAllocated,
        ),
      ).toBe(0);
    });

    await test.step("goods receipt writes the weighted COGS 190 to the article", async () => {
      await page.getByRole("link", { name: fixture.orderNumber }).click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/porudzbenice/${purchaseOrderId}$`),
      );
      const receiveButton = page.getByRole("button", {
        name: "Primi u magacin",
        exact: true,
      });
      await expect(receiveButton).toHaveCount(1);
      page.once("dialog", (dialog) => dialog.accept());
      await receiveButton.click();
      await expect
        .poll(async () =>
          (
            await db.purchaseOrder.findUniqueOrThrow({
              where: { id: purchaseOrderId },
              select: { status: true },
            })
          ).status,
        )
        .toBe("RECEIVED");
      const product = await db.product.findUniqueOrThrow({
        where: { id: productId },
        select: { stock: true, cogs: true },
      });
      expect(product.stock).toBe(150);
      expect(Number(product.cogs)).toBe(190);

      await page.goto(`/admin/erp/ulazne-fakture/${invoiceId}`, {
        waitUntil: "domcontentloaded",
      });
      const cogsRow = page.locator("tbody tr").filter({ hasText: fixture.sku });
      await expect(cogsRow).toContainText("190 RSD");
      await expect(
        page.getByRole("button", { name: "Uredi", exact: true }),
      ).toBeDisabled();
    });

    await test.step("storno removes the invoice from COGS without duplicating incoming stock", async () => {
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Storniraj", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Faktura je stornirana" }),
      ).toBeVisible();
      const [invoice, product, item] = await Promise.all([
        db.inboundInvoice.findUniqueOrThrow({ where: { id: invoiceId } }),
        db.product.findUniqueOrThrow({ where: { id: productId } }),
        db.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId } }),
      ]);
      expect(invoice.status).toBe("CANCELLED");
      expect(Number(item.additionalCostAllocated)).toBe(0);
      expect(product.incomingStock).toBe(0);
      expect(Number(product.cogs)).toBe(190);
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
    await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });
  }

  async function cleanup() {
    if (!db) return;
    if (invoiceId) {
      await db.inboundInvoice.deleteMany({ where: { id: invoiceId } });
    }
    if (purchaseOrderId) {
      await db.purchaseOrder.deleteMany({ where: { id: purchaseOrderId } });
    }
    if (productId) {
      await db.stockMovement.deleteMany({ where: { productId } });
      await db.warehouseStock.deleteMany({ where: { productId } });
      await db.product.deleteMany({ where: { id: productId } });
    }
    if (supplierId) {
      await db.supplier.deleteMany({ where: { id: supplierId } });
    }
    if (warehouseId) {
      await db.warehouse.deleteMany({ where: { id: warehouseId } });
    }
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
    }
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
  if (!raw) {
    throw new Error("Database URL is required for inbound-invoice acceptance.");
  }
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
