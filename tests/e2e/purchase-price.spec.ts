import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import ExcelJS from "exceljs";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("ERP module 3 purchase-price acceptance", () => {
  test.skip(
    process.env.E2E_PURCHASE_PRICES !== "1",
    "Set E2E_PURCHASE_PRICES=1 to run the isolated purchase-price write-and-cleanup suite.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-PURCHASE-PRICE-${runId}`;
  const fixture = {
    adminEmail: `qa.purchase.price.${runId}@example.invalid`,
    adminPassword: `QaPurchasePrice!${runId}x`,
    skuA: `QA-PP-A-${runId}`.slice(0, 90),
    skuB: `QA-PP-B-${runId}`.slice(0, 90),
    skuNoSupplier: `QA-PP-NO-SUP-${runId}`.slice(0, 90),
    skuNoParity: `QA-PP-NO-PAR-${runId}`.slice(0, 90),
    supplierA: `${tag} EUR dobavljač`,
    supplierB: `${tag} USD dobavljač`,
    supplierNoParity: `${tag} bez pariteta`,
    productA: `${tag} sto`,
    productB: `${tag} lampa`,
  };

  let db: PrismaClient;
  let adminId = "";
  let supplierAId = "";
  let supplierBId = "";
  let supplierNoParityId = "";
  let productAId = "";
  let productBId = "";
  let noSupplierProductId = "";
  let noParityProductId = "";
  let createdPriceId: string | null = null;
  const extraPriceIds = new Set<string>();
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
        lastName: "Purchase price",
      },
      select: { id: true },
    });
    adminId = admin.id;

    const [supplierA, supplierB, supplierNoParity] = await Promise.all([
      db.supplier.create({
        data: {
          code: `QA-PP-A-${runId}`.slice(0, 80),
          name: fixture.supplierA,
          currency: "EUR",
          parity: "DAP",
        },
        select: { id: true },
      }),
      db.supplier.create({
        data: {
          code: `QA-PP-B-${runId}`.slice(0, 80),
          name: fixture.supplierB,
          currency: "USD",
          parity: "EXW",
        },
        select: { id: true },
      }),
      db.supplier.create({
        data: {
          code: `QA-PP-NP-${runId}`.slice(0, 80),
          name: fixture.supplierNoParity,
          currency: "RSD",
          parity: null,
        },
        select: { id: true },
      }),
    ]);
    supplierAId = supplierA.id;
    supplierBId = supplierB.id;
    supplierNoParityId = supplierNoParity.id;

    const [productA, productB, noSupplierProduct, noParityProduct] =
      await Promise.all([
        db.product.create({
          data: {
            sku: fixture.skuA,
            slug: `qa-pp-a-${runId}`,
            name: fixture.productA,
            description: "QA artikal za nabavnu cenu",
            fullPrice: 1000,
            attribute1: "Masiv",
            attribute2: "Metal",
            attribute3: "Sklopivo",
            sizeLabel: "120x80",
            colorPrimary: "Natur",
            colorSecondary: "Grafit",
            supplierId: supplierA.id,
          },
          select: { id: true },
        }),
        db.product.create({
          data: {
            sku: fixture.skuB,
            slug: `qa-pp-b-${runId}`,
            name: fixture.productB,
            description: "QA zamenski artikal",
            fullPrice: 2000,
            sizeLabel: "Ø40",
            colorPrimary: "Bela",
            supplierId: supplierB.id,
          },
          select: { id: true },
        }),
        db.product.create({
          data: {
            sku: fixture.skuNoSupplier,
            slug: `qa-pp-no-supplier-${runId}`,
            name: `${tag} bez dobavljača`,
            description: "QA artikal bez dobavljača",
            fullPrice: 3000,
          },
          select: { id: true },
        }),
        db.product.create({
          data: {
            sku: fixture.skuNoParity,
            slug: `qa-pp-no-parity-${runId}`,
            name: `${tag} bez pariteta`,
            description: "QA artikal sa nepotpunim dobavljačem",
            fullPrice: 4000,
            supplierId: supplierNoParity.id,
          },
          select: { id: true },
        }),
      ]);
    productAId = productA.id;
    productBId = productB.id;
    noSupplierProductId = noSupplierProduct.id;
    noParityProductId = noParityProduct.id;
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("real OPS admin completes create, automatic lookup, edit, export and delete", async ({
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

    await test.step("module renders the exact requested commands and fields", async () => {
      await page.goto("/admin/erp/nabavne-cene", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "Cenovnik nabavnih cena" }),
      ).toBeVisible();

      const commandBar = page.locator("div.flex.flex-wrap.gap-2").filter({
        has: page.getByRole("button", { name: "Unos nove", exact: true }),
      });
      await expect(
        commandBar.getByRole("button").evaluateAll((buttons) =>
          buttons.slice(0, 3).map((button) => button.textContent?.trim()),
        ),
      ).resolves.toEqual(["Unos nove", "Uredi", "Brisanje"]);

      for (const header of [
        "Šifra artikla",
        "Dobavljač",
        "Naziv artikla",
        "Atributi artikla",
        "Dezen artikla",
        "Nabavna cena",
        "Valuta",
        "Paritet",
        "Važenje cene od",
        "Važenje cene do",
      ]) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeAttached();
      }
    });

    await test.step("create dialog requires only user-entered fields", async () => {
      await page.getByRole("button", { name: "Unos nove", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Šifra artikla *")).toContainText(
        fixture.skuA,
      );
      await dialog.getByLabel("Šifra artikla *").selectOption(fixture.skuA);
      await dialog.getByLabel("Nabavna cena *").fill("123.45");
      await dialog.getByLabel("Važenje cene od *").fill("2030-01-01");
      await dialog.getByLabel("Važenje cene do").fill("2030-12-31");
      await dialog.getByRole("button", { name: "Unos nove", exact: true }).click();

      await expect(dialog).toHaveCount(0);
      await expect
        .poll(async () => {
          const audit = await db.auditLog.findFirst({
            where: {
              actorId: adminId,
              action: "erp.command.purchase-price.create",
              entity: "erp:nabavne-cene",
            },
            orderBy: { createdAt: "desc" },
            select: { entityId: true },
          });
          return audit?.entityId ?? null;
        })
        .not.toBeNull();
      createdPriceId = (
        await db.auditLog.findFirstOrThrow({
          where: {
            actorId: adminId,
            action: "erp.command.purchase-price.create",
            entity: "erp:nabavne-cene",
          },
          orderBy: { createdAt: "desc" },
          select: { entityId: true },
        })
      ).entityId;
      if (!createdPriceId) throw new Error("Create audit is missing price ID.");
    });

    await test.step("article and supplier values are linked and copied automatically", async () => {
      const price = await db.purchasePrice.findUniqueOrThrow({
        where: { id: createdPriceId! },
      });
      expect({
        productId: price.productId,
        supplierId: price.supplierId,
        sku: price.sku,
        name: price.name,
        attributes: price.attributes,
        pattern: price.pattern,
        price: Number(price.price),
        currency: price.currency,
        parity: price.parity,
        validFrom: price.validFrom.toISOString().slice(0, 10),
        validTo: price.validTo?.toISOString().slice(0, 10),
      }).toEqual({
        productId: productAId,
        supplierId: supplierAId,
        sku: fixture.skuA,
        name: fixture.productA,
        attributes: "Masiv / Metal / Sklopivo",
        pattern: "Natur + Grafit",
        price: 123.45,
        currency: "EUR",
        parity: "DAP",
        validFrom: "2030-01-01",
        validTo: "2030-12-31",
      });

      const row = page.locator("tbody tr").filter({ hasText: fixture.skuA });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(fixture.supplierA);
      await expect(row).toContainText(fixture.productA);
      await expect(row).toContainText("Masiv / Metal / Sklopivo");
      await expect(row).toContainText("Natur + Grafit");
      await expect(row).toContainText("€");
      await expect(row).toContainText("DAP");
      await expect(
        page.getByRole("button", { name: "Završi uređivanje" }),
      ).toBeVisible();

      for (const label of [
        "Dobavljač",
        "Naziv artikla",
        "Atributi artikla",
        "Dezen artikla",
        "Valuta",
        "Paritet",
      ]) {
        const cell = await cellFor(page, row, label);
        await expect(cell.locator("button")).toBeDisabled();
      }
    });

    await test.step("server rejects invalid creates and protected-field tampering", async () => {
      const invalidCreates = [
        [
          { sku: "NE-POSTOJI", purchasePrice: "1", validFrom: "2030-01-01" },
          "ne postoji u bazi artikala",
        ],
        [
          {
            sku: fixture.skuNoSupplier,
            purchasePrice: "1",
            validFrom: "2030-01-01",
          },
          "nema povezanog dobavljača",
        ],
        [
          {
            sku: fixture.skuNoParity,
            purchasePrice: "1",
            validFrom: "2030-01-01",
          },
          "nema unet paritet",
        ],
        [
          { sku: fixture.skuA, purchasePrice: "-1", validFrom: "2030-01-01" },
          "Nabavna cena",
        ],
        [
          {
            sku: fixture.skuA,
            purchasePrice: "1.234",
            validFrom: "2030-01-01",
          },
          "Nabavna cena",
        ],
        [
          { sku: fixture.skuA, purchasePrice: "1", validFrom: "2030-02-30" },
          "ispravan datum",
        ],
        [
          {
            sku: fixture.skuA,
            purchasePrice: "1",
            validFrom: "2030-02-01",
            validTo: "2030-01-31",
          },
          "ne može biti pre",
        ],
      ] as const;

      for (const [input, expectedError] of invalidCreates) {
        const response = await page.request.post(
          "/api/admin/erp/nabavne-cene/commands",
          {
            data: { action: "purchase-price.create", ids: [], input },
          },
        );
        expect(response.status(), JSON.stringify(input)).toBe(400);
        expect(
          ((await response.json()) as { error?: string }).error,
          JSON.stringify(input),
        ).toContain(expectedError);
      }

      const wrongModuleResponse = await page.request.post(
        "/api/admin/erp/dobavljaci/commands",
        {
          data: {
            action: "purchase-price.create",
            ids: [],
            input: {
              sku: fixture.skuA,
              purchasePrice: "1",
              validFrom: "2030-01-01",
            },
          },
        },
      );
      expect(wrongModuleResponse.status()).toBe(400);

      for (const columnKey of [
        "supplier",
        "name",
        "attributes",
        "pattern",
        "currency",
        "parity",
      ]) {
        const response = await page.request.patch(
          `/api/admin/erp/nabavne-cene/rows/${createdPriceId}`,
          { data: { columnKey, value: "HACK" } },
        );
        expect(response.status(), columnKey).toBe(422);
      }
    });

    await test.step("multiple periods and case-insensitive canonical SKU are supported", async () => {
      const response = await page.request.post(
        "/api/admin/erp/nabavne-cene/commands",
        {
          data: {
            action: "purchase-price.create",
            ids: [],
            input: {
              sku: fixture.skuA.toLowerCase(),
              purchasePrice: "130",
              validFrom: "2031-01-01",
              validTo: "",
            },
          },
        },
      );
      expect(response.status()).toBe(200);
      const payload = (await response.json()) as {
        ok?: boolean;
        createdId?: string;
      };
      expect(payload.ok).toBe(true);
      expect(payload.createdId).toBeTruthy();
      extraPriceIds.add(payload.createdId!);
      const extra = await db.purchasePrice.findUniqueOrThrow({
        where: { id: payload.createdId! },
      });
      expect(extra.sku).toBe(fixture.skuA);
      expect(extra.validTo).toBeNull();
      expect(
        await db.purchasePrice.count({
          where: { productId: productAId },
        }),
      ).toBe(2);
    });

    await test.step("server validates every editable field without corrupting the row", async () => {
      const invalidUpdates = [
        ["purchasePrice", -1, "Nabavna cena"],
        ["purchasePrice", "1.234", "Nabavna cena"],
        ["validFrom", "2030-02-30", "ispravan datum"],
        ["validFrom", "2031-01-01", "ne može biti pre"],
        ["validTo", "2029-12-31", "ne može biti pre"],
        ["sku", "NE-POSTOJI", "ne postoji u bazi artikala"],
        ["sku", fixture.skuNoSupplier, "nema povezanog dobavljača"],
        ["sku", fixture.skuNoParity, "nema unet paritet"],
      ] as const;

      for (const [columnKey, value, expectedError] of invalidUpdates) {
        const response = await page.request.patch(
          `/api/admin/erp/nabavne-cene/rows/${createdPriceId}`,
          { data: { columnKey, value } },
        );
        expect(response.status(), columnKey).toBe(400);
        expect(
          ((await response.json()) as { error?: string }).error,
          columnKey,
        ).toContain(expectedError);
      }

      const unchanged = await db.purchasePrice.findUniqueOrThrow({
        where: { id: createdPriceId! },
      });
      expect(unchanged.sku).toBe(fixture.skuA);
      expect(Number(unchanged.price)).toBe(123.45);
      expect(unchanged.validFrom.toISOString().slice(0, 10)).toBe("2030-01-01");
      expect(unchanged.validTo?.toISOString().slice(0, 10)).toBe("2030-12-31");
    });

    await test.step("admin edits price, dates and SKU while automatic values stay authoritative", async () => {
      let row = rowForId(page, createdPriceId!);

      await setTextCell(page, row, "Nabavna cena", "234.56");
      await setTextCell(page, row, "Važenje cene do", "");
      await setTextCell(page, row, "Važenje cene od", "2032-02-29");
      await setSelectCell(page, row, "Šifra artikla", fixture.skuB);

      await expect
        .poll(async () => {
          const price = await db.purchasePrice.findUniqueOrThrow({
            where: { id: createdPriceId! },
          });
          return {
            sku: price.sku,
            price: Number(price.price),
            validFrom: price.validFrom.toISOString().slice(0, 10),
            validTo: price.validTo,
          };
        })
        .toEqual({
          sku: fixture.skuB,
          price: 234.56,
          validFrom: "2032-02-29",
          validTo: null,
        });

      const saved = await db.purchasePrice.findUniqueOrThrow({
        where: { id: createdPriceId! },
      });
      expect({
        productId: saved.productId,
        supplierId: saved.supplierId,
        name: saved.name,
        attributes: saved.attributes,
        pattern: saved.pattern,
        currency: saved.currency,
        parity: saved.parity,
      }).toEqual({
        productId: productBId,
        supplierId: supplierBId,
        name: fixture.productB,
        attributes: "Ø40",
        pattern: "Bela",
        currency: "USD",
        parity: "EXW",
      });

      row = rowForId(page, createdPriceId!);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(fixture.skuB);
      await expect(row).toContainText(fixture.supplierB);
      await expect(row).toContainText(fixture.productB);
      await expect(row).toContainText("Ø40");
      await expect(row).toContainText("Bela");
      await expect(row).toContainText("$");
      await expect(row).toContainText("EXW");
    });

    await test.step("reload, search and XLSX export retain the authoritative values", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      const search = page.getByPlaceholder(
        "Brza pretraga po vidljivim kolonama",
      );
      const rowsResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/admin/erp/nabavne-cene/rows" &&
          url.searchParams.get("q") === fixture.skuB
        );
      });
      await search.fill(fixture.skuB);
      await rowsResponse;
      const row = page.locator("tbody tr").filter({ hasText: fixture.skuB });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(fixture.supplierB);

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Excel", exact: true }).click();
      const download = await downloadPromise;
      const filePath = await download.path();
      if (!filePath) throw new Error("XLSX download did not produce a file.");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      expect(worksheet.rowCount).toBe(2);
      expect(worksheet.getRow(1).values).toEqual([
        undefined,
        "Šifra artikla",
        "Dobavljač",
        "Naziv artikla",
        "Atributi artikla",
        "Dezen artikla",
        "Nabavna cena",
        "Valuta",
        "Paritet",
        "Važenje cene od",
        "Važenje cene do",
      ]);
      expect(worksheet.getRow(2).values).toContain(fixture.skuB);
      expect(worksheet.getRow(2).values).toContain(fixture.supplierB);
      expect(worksheet.getRow(2).values).toContain(234.56);
    });

    await test.step("cancelled delete is harmless and confirmed delete is persisted and audited", async () => {
      const row = page.locator("tbody tr").filter({ hasText: fixture.skuB });
      await row.getByRole("checkbox").check();
      const deleteButton = page.getByRole("button", {
        name: "Brisanje (1)",
        exact: true,
      });

      await clickConfirmation(page, deleteButton, false);
      await expect
        .poll(() =>
          db.purchasePrice.count({ where: { id: createdPriceId! } }),
        )
        .toBe(1);
      await clickConfirmation(page, deleteButton, true);
      await expect
        .poll(() =>
          db.purchasePrice.count({ where: { id: createdPriceId! } }),
        )
        .toBe(0);
      await expect
        .poll(() =>
          db.auditLog.count({
            where: {
              actorId: adminId,
              action: "erp.command.row.delete",
              entity: "erp:nabavne-cene",
              entityId: createdPriceId,
            },
          }),
        )
        .toBe(1);
      createdPriceId = null;
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
    const productIds = [
      productAId,
      productBId,
      noSupplierProductId,
      noParityProductId,
    ].filter(Boolean);
    if (productIds.length) {
      await db.purchasePrice.deleteMany({
        where: { productId: { in: productIds } },
      });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (extraPriceIds.size || createdPriceId) {
      await db.purchasePrice.deleteMany({
        where: {
          id: {
            in: [
              ...extraPriceIds,
              ...(createdPriceId ? [createdPriceId] : []),
            ],
          },
        },
      });
    }
    const supplierIds = [
      supplierAId,
      supplierBId,
      supplierNoParityId,
    ].filter(Boolean);
    if (supplierIds.length) {
      await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    }
    if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
    extraPriceIds.clear();
  }
});

async function cellFor(page: Page, row: Locator, label: string) {
  const index = await page
    .getByRole("columnheader")
    .filter({
      has: page.getByRole("button", { name: label, exact: true }),
    })
    .evaluate((element) => (element as HTMLTableCellElement).cellIndex);
  return row.locator("td").nth(index);
}

function rowForId(page: Page, rowId: string) {
  return page.locator("tbody tr").filter({
    has: page.getByRole("checkbox", { name: `Izaberi red ${rowId}` }),
  });
}

async function setTextCell(
  page: Page,
  row: Locator,
  label: string,
  value: string,
) {
  const cell = await cellFor(page, row, label);
  await cell.locator("button").click();
  const input = cell.locator("input");
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
}

async function setSelectCell(
  page: Page,
  row: Locator,
  label: string,
  value: string,
) {
  const cell = await cellFor(page, row, label);
  await cell.locator("button").click();
  const select = cell.locator("select");
  await expect(select).toBeVisible();
  await expect(select.locator(`option[value="${value}"]`)).toHaveCount(1);
  await select.selectOption(value);
  await expect(select).toHaveCount(0);
}

async function clickConfirmation(
  page: Page,
  locator: Locator,
  accept: boolean,
) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = locator.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toContain("Obrisati");
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clickPromise;
}

function createDatabaseClient() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for purchase-price acceptance.");
  const url = new URL(raw);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const testDatabase = /test/i.test(decodeURIComponent(url.pathname));
  const remoteExplicitlyAllowed =
    process.env.E2E_ALLOW_REMOTE_PURCHASE_PRICE_DB === "true";
  if ((!testDatabase || !localHost) && !remoteExplicitlyAllowed) {
    throw new Error(
      "Refusing purchase-price mutations: use a local database whose name contains “test”, or explicitly set E2E_ALLOW_REMOTE_PURCHASE_PRICE_DB=true after approving remote QA writes.",
    );
  }
  if (!localHost) {
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
