// Acceptance: MARKO-106
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";

test.describe("MARKO-106 — DC sortiranje po koloni U dolasku", () => {
  test.skip(
    process.env.E2E_MODULE_8_WAREHOUSES !== "1" || !process.env.DATABASE_URL,
    "Pokreće se samo nad izolovanom E2E šemom.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.use({ actionTimeout: 20_000 });

  const runId = `${Date.now()}-${process.pid}`;
  const prefix = `QA-INCOMING-${runId}`;
  const adminEmail = `qa.incoming.${runId}@example.invalid`;
  let db: PrismaClient;
  let adminId = "";
  let warehouseId = "";
  let createdWarehouse = false;
  let draftProduct: { id: string; sku: string; name: string };
  let storedProductId = "";
  const additionalWarehouseIds: string[] = [];
  const productIds: string[] = [];
  const purchaseOrderIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const existingWarehouse = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const warehouse =
      existingWarehouse ??
      (await db.warehouse.create({
        data: {
          code: `QA-DC-${runId}`.slice(0, 40),
          name: "DC",
          active: true,
          isDefault: true,
        },
        select: { id: true },
      }));
    createdWarehouse = !existingWarehouse;
    warehouseId = warehouse.id;
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(`QaIncoming!${runId}`, 10),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Incoming sort",
      },
      select: { id: true },
    });
    adminId = admin.id;

    const fillerData = Array.from({ length: 105 }, (_, index) => ({
      sku: `${prefix}-FILL-${String(index).padStart(3, "0")}`.slice(0, 100),
      slug: `qa-incoming-${runId}-fill-${index}`,
      name: `QA filler ${index}`,
      description: "MARKO-106 pagination fixture",
      fullPrice: 1000,
    }));
    await db.product.createMany({ data: fillerData });
    const fillers = await db.product.findMany({
      where: { sku: { startsWith: `${prefix}-FILL-` } },
      select: { id: true },
    });
    productIds.push(...fillers.map((product) => product.id));
    await db.warehouseStock.createMany({
      data: fillers.map((product) => ({
        warehouseId,
        productId: product.id,
        qty: 0,
      })),
    });

    const draft = await createProduct("DRAFT-100");
    draftProduct = draft;
    const sent = await createProduct("SENT-10");
    const confirmed = await createProduct("CONFIRMED-5");
    storedProductId = (await createProduct("STORED-7", {
      incomingStock: 7,
    })).id;
    const synthetic = await createProduct("SYNTHETIC-50", {
      withWarehouseStock: false,
    });
    const received = await createProduct("RECEIVED-999");
    const cancelled = await createProduct("CANCELLED-888");
    const fullyReceived = await createProduct("FULL-RECEIVED-20");

    await createPurchaseOrder("DRAFT-A", "DRAFT", draft, 30, 0, "2026-11-05");
    await createPurchaseOrder("DRAFT-B", "DRAFT", draft, 30, 0, "2026-11-05");
    await createPurchaseOrder("DRAFT-C", "DRAFT", draft, 40, 0, "2026-11-10", true);
    await createPurchaseOrder("SENT", "SENT", sent, 15, 5, "2026-11-07");
    await createPurchaseOrder("CONFIRMED", "CONFIRMED", confirmed, 5, 0, "2026-11-06");
    await createPurchaseOrder("SYNTHETIC", "DRAFT", synthetic, 50, 0, "2026-11-08");
    await createPurchaseOrder("RECEIVED", "RECEIVED", received, 999, 0, "2026-11-02", true);
    await createPurchaseOrder("CANCELLED", "CANCELLED", cancelled, 888, 0, "2026-10-01");
    await createPurchaseOrder(
      "FULL-RECEIVED",
      "CONFIRMED",
      fullyReceived,
      20,
      20,
    );

    async function createProduct(
      suffix: string,
      options: { incomingStock?: number; withWarehouseStock?: boolean } = {},
    ) {
      const sku = `${prefix}-${suffix}`.slice(0, 100);
      const product = await db.product.create({
        data: {
          sku,
          slug: `qa-incoming-${runId}-${suffix.toLowerCase()}`,
          name: `QA ${suffix}`,
          description: "MARKO-106 incoming sorting fixture",
          fullPrice: 1000,
          incomingStock: options.incomingStock ?? 0,
          ...(options.withWarehouseStock === false
            ? {}
            : { warehouseStocks: { create: { warehouseId, qty: 0 } } }),
        },
        select: { id: true, sku: true, name: true },
      });
      productIds.push(product.id);
      return product;
    }

    async function createPurchaseOrder(
      suffix: string,
      status: "DRAFT" | "SENT" | "CONFIRMED" | "RECEIVED" | "CANCELLED",
      product: { id: string; sku: string; name: string },
      qty: number,
      receivedQty: number,
      deliveryDate?: string,
      archived = false,
    ) {
      const order = await db.purchaseOrder.create({
        data: {
          number: `QA-106-${runId}-${suffix}`.slice(0, 80),
          status,
          deliveryDate: deliveryDate ? new Date(`${deliveryDate}T00:00:00Z`) : null,
          archivedAt: archived ? new Date() : null,
          receivingWarehouseId: warehouseId,
          items: {
            create: {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              purchasePrice: 100,
              qty,
              receivedQty,
            },
          },
        },
        select: { id: true },
      });
      purchaseOrderIds.push(order.id);
    }
  });

  test.afterAll(async () => {
    try {
      if (adminId) {
        await db.adminSavedView.deleteMany({ where: { adminUserId: adminId } });
        await db.auditLog.deleteMany({ where: { actorId: adminId } });
      }
      if (purchaseOrderIds.length) {
        await db.purchaseOrder.deleteMany({
          where: { id: { in: purchaseOrderIds } },
        });
      }
      if (productIds.length) {
        await db.warehouseStock.deleteMany({
          where: { productId: { in: productIds } },
        });
        await db.product.deleteMany({ where: { id: { in: productIds } } });
      }
      if (adminId) {
        await db.adminUser.deleteMany({ where: { id: adminId } });
      }
      if (createdWarehouse && warehouseId) {
        await db.warehouse.deleteMany({ where: { id: warehouseId } });
      }
      if (additionalWarehouseIds.length) {
        await db.warehouse.deleteMany({ where: { id: { in: additionalWarehouseIds } } });
      }
    } finally {
      await db?.$disconnect();
    }
  });

  test("API sortira ceo skup pre paginacije, pretrage i filtera", async ({
    context,
    page,
  }) => {
    await authenticate(context);

    const positiveFilter = [
      {
        id: "incoming-positive",
        columnKey: "incoming",
        operator: "gt",
        value: "0",
      },
    ];
    const ascending = [{ columnKey: "incoming", direction: "asc" }];
    const descending = [{ columnKey: "incoming", direction: "desc" }];

    const asc = await fetchRows(page, {
      filters: positiveFilter,
      sorting: ascending,
      pageSize: 100,
    });
    expect(asc.total).toBe(6);
    expect(incomingValues(asc)).toEqual([5, 7, 10, 50, 100, 999]);

    const desc = await fetchRows(page, {
      filters: positiveFilter,
      sorting: descending,
      pageSize: 100,
    });
    expect(incomingValues(desc)).toEqual([999, 100, 50, 10, 7, 5]);
    // RECEIVED with an unreceived remainder is still incoming; only CANCELLED is excluded.
    expect(desc.rows[0]?.values.sku).toContain("RECEIVED-999");
    expect(desc.rows[2]?.id).toContain("incoming:");

    const secondPage = await fetchRows(page, {
      filters: positiveFilter,
      sorting: descending,
      page: 2,
      pageSize: 2,
    });
    expect(secondPage.pageCount).toBe(3);
    expect(incomingValues(secondPage)).toEqual([50, 10]);

    const searched = await fetchRows(page, {
      filters: positiveFilter,
      sorting: descending,
      q: `${prefix}-SYNTHETIC-50`,
      searchColumn: "sku",
      pageSize: 100,
    });
    expect(searched.total).toBe(1);
    expect(incomingValues(searched)).toEqual([50]);

    const invalidSort = await fetchRows(page, {
      sorting: [{ columnKey: "incoming", direction: "sideways" }],
      pageSize: 100,
    });
    expect(invalidSort.total).toBe(113);
    expect(invalidSort.rows).toHaveLength(100);
  });

  test("UI prolazi pagination, ASC/DESC/reset, filter, search i saved view", async ({
    context,
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await authenticate(context);
    await page.goto("/admin/erp/stanje-po-magacinima", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("113 ukupno", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Sledeća strana" }).click();
    await expect(page.getByText("Strana 2 od 2", { exact: true })).toBeVisible();

    const incomingHeader = page.getByRole("button", {
      name: /^U dolasku(?: [↑↓])?$/,
    });
    await incomingHeader.click();
    await expect(page.getByText("Strana 1 od 2", { exact: true })).toBeVisible();
    await expect(incomingHeader).toContainText("↑");

    await page.getByText("Filteri", { exact: true }).click();
    await page.getByLabel("Kolona za novi filter").selectOption("incoming");
    await page.getByRole("button", { name: "Dodaj filter", exact: true }).click();
    await page.getByLabel("Operator U dolasku").selectOption("gt");
    await page.getByLabel("Filter U dolasku").fill("0");
    await page.getByRole("button", { name: "Gotovo", exact: true }).click();
    await expect(page.getByText("6 ukupno", { exact: false })).toBeVisible();
    await expectIncomingValues(page, [5, 7, 10, 50, 100, 999]);

    await incomingHeader.click();
    await expect(incomingHeader).toContainText("↓");
    await expectIncomingValues(page, [999, 100, 50, 10, 7, 5]);

    await page.getByRole("button", { name: "Sačuvaj pogled", exact: true }).click();
    await page.getByLabel("Naziv pogleda", { exact: true }).fill("QA U dolasku DESC");
    await page.getByRole("dialog").getByRole("button", { name: "Sačuvaj", exact: true }).click();
    // Saving changes the selected view and refreshes the server component;
    // assert persisted state instead of the transient pre-refresh status text.
    await expect(page).toHaveURL(/savedView=/);
    await expect(page.getByText("Pogled: QA U dolasku DESC", { exact: true })).toBeVisible();

    await incomingHeader.click();
    await expect(incomingHeader).not.toContainText(/[↑↓]/);

    await page.getByText("Prikaz tabele", { exact: true }).click();
    await page
      .getByRole("button", { name: "QA U dolasku DESC", exact: true })
      .click();
    await expect(incomingHeader).toContainText("↓");
    await expectIncomingValues(page, [999, 100, 50, 10, 7, 5]);

    await page.getByLabel("Opseg brze pretrage").selectOption("sku");
    await page
      .getByPlaceholder("Pretraga: SKU")
      .fill(`${prefix}-SYNTHETIC-50`);
    await expect(page.getByText("1 ukupno", { exact: false })).toBeVisible();
    await expectIncomingValues(page, [50]);
    await page.getByPlaceholder("Pretraga: SKU").fill("");
    await expect(page.getByText("6 ukupno", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /^SKU(?: [↑↓])?$/ }).click();
    await expect(incomingHeader).not.toContainText(/[↑↓]/);
    await expect(page.getByRole("button", { name: /^SKU ↑$/ })).toBeVisible();

    expect(runtimeErrors).toEqual([]);
  });

  test("prvi dolazak podržava sortiranje i filter, a kartica koristi samo default DC", async ({ context, page }) => {
    await authenticate(context);
    const beforeSeventh = [{ id: "date", columnKey: "firstIncomingDate", operator: "before", value: "2026-11-07" }];
    const dated = await fetchRows(page, { filters: beforeSeventh, sorting: [{ columnKey: "firstIncomingDate", direction: "asc" }] });
    expect(dated.rows.map(row => [row.values.firstIncomingDate, row.values.firstIncomingQty])).toEqual([
      ["2026-11-02", 999], ["2026-11-05", 60], ["2026-11-06", 5],
    ]);
    const byQuantity = await fetchRows(page, {
      filters: [{ id: "first-qty", columnKey: "firstIncomingQty", operator: "gt", value: "50" }],
      sorting: [{ columnKey: "firstIncomingQty", direction: "asc" }],
    });
    expect(byQuantity.rows.map(row => row.values.firstIncomingQty)).toEqual([60, 999]);

    const secondary = await db.warehouse.create({ data: { code: `QA-OTHER-${runId}`.slice(0, 40), name: "QA drugi magacin", active: true, isDefault: false } });
    additionalWarehouseIds.push(secondary.id);
    const otherOrder = await db.purchaseOrder.create({ data: {
      number: `QA-106-${runId}-OTHER`, status: "DRAFT", receivingWarehouseId: secondary.id,
      deliveryDate: new Date("2026-11-01T00:00:00Z"),
      items: { create: { productId: draftProduct.id, sku: draftProduct.sku, name: draftProduct.name, purchasePrice: 100, qty: 70 } },
    } });
    purchaseOrderIds.push(otherOrder.id);
    const split = await fetchRows(page, { q: draftProduct.sku, searchColumn: "sku", sorting: [{ columnKey: "firstIncomingDate", direction: "asc" }] });
    expect(split.rows.map(row => [row.values.firstIncomingDate, row.values.firstIncomingQty, row.values.incoming])).toEqual([
      ["2026-11-01", 70, 70], ["2026-11-05", 60, 100],
    ]);

    await page.goto("/admin/erp/stanje-po-magacinima", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Opseg brze pretrage").selectOption("sku");
    await page.getByPlaceholder("Pretraga: SKU").fill(draftProduct.sku);
    await expect(page.getByText("2 ukupno", { exact: false })).toBeVisible();
    const dateHeader = page.getByRole("button", { name: /^Prvi očekivani dolazak(?: [↑↓])?$/ });
    await dateHeader.click();
    await expect(dateHeader).toContainText("↑");
    await expect.poll(() => incomingColumnTexts(page, "Količina prvog dolaska")).toEqual(["70", "60"]);
    const quantityHeader = page.getByRole("button", { name: /^Količina prvog dolaska(?: [↑↓])?$/ });
    await quantityHeader.click();
    await expect.poll(() => incomingColumnTexts(page, "Količina prvog dolaska")).toEqual(["60", "70"]);
    await page.getByText("Filteri", { exact: true }).click();
    await page.getByLabel("Kolona za novi filter").selectOption("firstIncomingDate");
    await page.getByRole("button", { name: "Dodaj filter", exact: true }).click();
    await page.getByLabel("Operator Prvi očekivani dolazak").selectOption("before");
    await page.getByLabel("Filter Prvi očekivani dolazak").fill("2026-11-03");
    await page.getByRole("button", { name: "Gotovo", exact: true }).click();
    await expect(page.getByText("1 ukupno", { exact: false })).toBeVisible();
    await expect.poll(() => incomingColumnTexts(page, "Količina prvog dolaska")).toEqual(["70"]);

    await page.goto(`/admin/erp/artikli/${draftProduct.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("U dolasku", { exact: true }).locator("..")).toContainText("100 kom");
    const cardDate = page.getByText("Prvi očekivani dolazak", { exact: true }).locator("..");
    const cardQty = page.getByText("Količina prvog dolaska", { exact: true }).locator("..");
    await expect(cardDate).toContainText("05.11.2026.");
    await expect(cardQty).toContainText("60 kom");
    await expect(cardDate.locator("input")).toHaveCount(0);
    await expect(cardQty.locator("input")).toHaveCount(0);
    await page.goto(`/admin/erp/artikli/${storedProductId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("U dolasku", { exact: true }).locator("..")).toContainText("7 kom");
    await expect(page.getByText("Prvi očekivani dolazak", { exact: true }).locator("..").locator("p").nth(1)).toHaveText("—");
    await expect(page.getByText("Količina prvog dolaska", { exact: true }).locator("..").locator("p").nth(1)).toHaveText("—");
  });

  async function authenticate(context: BrowserContext) {
    const authSecret = process.env.AUTH_SECRET;
    if (!authSecret) throw new Error("AUTH_SECRET je obavezan za E2E.");
    const cookieName = "authjs.session-token";
    const token = await encode({
      secret: authSecret,
      salt: cookieName,
      maxAge: 60 * 60,
      token: {
        sub: adminId,
        uid: adminId,
        email: adminEmail,
        name: "QA Incoming sort",
        userType: "admin",
        role: "SUPER",
      },
    });
    await context.addCookies([
      {
        name: cookieName,
        value: token,
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
});

type RowsPayload = {
  rows: Array<{ id: string; values: Record<string, unknown> }>;
  page: number;
  pageCount: number;
  total: number;
};

async function fetchRows(
  page: Page,
  options: {
    filters?: unknown[];
    sorting?: unknown[];
    q?: string;
    searchColumn?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 100),
    q: options.q ?? "",
    searchColumn: options.searchColumn ?? "",
    filters: JSON.stringify(options.filters ?? []),
    sorting: JSON.stringify(options.sorting ?? []),
    columns: JSON.stringify([
      "warehouse",
      "sku",
      "product",
      "physical",
      "reserved",
      "available",
      "incoming",
      "firstIncomingDate",
      "firstIncomingQty",
      "web",
      "wholesale",
      "export",
    ]),
  });
  const response = await page.request.get(
    `/api/admin/erp/stanje-po-magacinima/rows?${params}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as RowsPayload;
}

function incomingValues(payload: RowsPayload) {
  return payload.rows.map((row) => row.values.incoming);
}

async function incomingColumnTexts(page: Page, label: string) {
  const table = page.locator("table").last();
  const headers = await table.locator("thead th").allInnerTexts();
  const index = headers.findIndex(header => header.includes(label));
  if (index < 0) throw new Error(`Kolona ${label} nije pronađena.`);
  const rows = await table.locator("tbody tr").all();
  return Promise.all(rows.map(row => row.locator("td").nth(index).innerText().then(value => value.trim())));
}

async function incomingColumnValues(page: Page) {
  const table = page.locator("table").last();
  const headers = await table.locator("thead th").allInnerTexts();
  const incomingIndex = headers.findIndex((header) =>
    header.includes("U dolasku"),
  );
  if (incomingIndex < 0) throw new Error("Kolona U dolasku nije pronađena.");
  const rows = await table.locator("tbody tr").all();
  const values: number[] = [];
  for (const row of rows) {
    const cells = row.locator("td");
    if ((await cells.count()) <= incomingIndex) continue;
    const raw = (await cells.nth(incomingIndex).innerText()).trim();
    if (/^-?\d+$/.test(raw)) values.push(Number(raw));
  }
  return values;
}

async function expectIncomingValues(page: Page, expected: number[]) {
  await expect
    .poll(() => incomingColumnValues(page), { timeout: 20_000 })
    .toEqual(expected);
}

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL је обавезан за E2E.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set("sslmode", "no-verify");
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
    transactionOptions: { maxWait: 30_000, timeout: 60_000 },
  });
}
