import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("article XLSX import workflow", () => {
  test.skip(
    process.env.E2E_ARTICLE_IMPORT !== "1",
    "Set E2E_ARTICLE_IMPORT=1 and use an isolated database.",
  );

  test.setTimeout(240_000);
  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-ARTICLE-IMPORT-${runId}`;
  const adminEmail = `qa.article.import.${runId}@example.invalid`;
  const adminPassword = `QaImport!${runId}x`;
  const supplierCode = `QAI-${runId}`.slice(0, 40);
  const supplierName = `${tag} dobavljač`;
  let db: PrismaClient;
  let adminId = "";
  let importedProductId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const [admin] = await db.$transaction([
      db.adminUser.create({
        data: {
          email: adminEmail,
          passwordHash,
          role: "SUPER",
          enabled: true,
          firstName: "QA",
          lastName: "Article import",
        },
        select: { id: true },
      }),
      db.supplier.create({
        data: {
          code: supplierCode,
          name: supplierName,
          country: "CN",
          parity: "DAP",
          deliveryDays: 7,
        },
      }),
    ]);
    adminId = admin.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      const products = await db.product.findMany({
        where: {
          OR: [
            { id: importedProductId || "__missing__" },
            { shortName: tag },
          ],
        },
        select: { id: true },
      });
      const productIds = products.map((product) => product.id);
      if (productIds.length) {
        await db.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await db.product.deleteMany({ where: { id: { in: productIds } } });
      }
      await db.group.deleteMany({ where: { name: `${tag} kategorija` } });
      await db.category.deleteMany({ where: { name: `${tag} kategorija` } });
      await db.supplier.deleteMany({ where: { code: supplierCode } });
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({ where: { key: { contains: adminEmail } } });
      await db.adminUser.deleteMany({ where: { email: adminEmail } });
    } finally {
      await db.$disconnect();
    }
  });

  test("uses the supplier country when the discovered sheet omits country of origin", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    const callbackUrl = "/admin/erp/artikli/import";
    await page.goto(
      `/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(new RegExp(`${callbackUrl}$`), {
      timeout: 120_000,
    });

    await expect(
      page.getByRole("link", { name: "Preuzmi XLSX šablon" }),
    ).toBeVisible();
    const templateResponse = await page.request.get(
      "/api/admin/erp/articles/import/template",
    );
    expect(templateResponse.ok()).toBe(true);
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.load((await templateResponse.body()) as never);
    const templateHeaders = (templateWorkbook.getWorksheet("Artikli")?.getRow(1)
      .values as unknown[])
      .slice(1)
      .map(String);
    expect(templateHeaders).toEqual(
      expect.arrayContaining(["Zemlja porekla", "Tarifni broj"]),
    );

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Export Summary").addRow([
      "Kratki naziv",
      "Ovo je sažetak, ne lista artikala",
    ]);
    const articles = workbook.addWorksheet("Artikli");
    articles.addRow(["QA izvoz artikala"]);
    articles.addRow([]);
    articles.addRow([
      "Kratki naziv",
      "Opis za sajt",
      "Dobavljač",
      "Kategorija",
      "Tarifni broj",
      "Širina artikla",
      "Dubina artikla",
      "Visina artikla",
      "Bruto težina artikla",
      "Broj artikala u pakovanju",
      "Širina transportnog pakovanja",
      "Dubina transportnog pakovanja",
      "Visina transportnog pakovanja",
      "Bruto težina transportnog pakovanja",
      "Širina pakovanja pojedinačnog artikla",
      "Dubina pakovanja pojedinačnog artikla",
      "Visina pakovanja pojedinačnog artikla",
      "MPC",
      "Zalihe",
      "Status",
    ]);
    articles.addRow([
      tag,
      "<p>QA artikal za proveru automatskog uvoza.</p>",
      supplierName,
      `${tag} kategorija`,
      "94032080",
      40,
      30,
      20,
      7,
      1,
      44,
      34,
      24,
      8,
      44,
      34,
      24,
      1_999,
      5,
      "DTZ",
    ]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    await page.getByLabel("XLSX datoteka").setInputFiles({
      name: `article-import-${runId}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    });

    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/erp/articles/import") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Prikaži preview" }).click();
    const previewResponse = await previewResponsePromise;
    const previewPayload = await previewResponse.json();
    expect(previewResponse.ok(), JSON.stringify(previewPayload)).toBe(true);
    expect(previewPayload.source).toMatchObject({
      worksheet: "Artikli",
      headerRow: 3,
    });
    expect(previewPayload.source.columns).toContain("Tarifni broj");
    expect(previewPayload.source.columns).not.toContain("Zemlja porekla");
    expect(previewPayload.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("zemlju iz kartice dobavljača"),
      ]),
    );
    await expect(page.getByRole("status")).toContainText(
      "Prepoznat list „Artikli“, zaglavlje u redu 3",
    );
    await expect(page.getByRole("status")).toContainText(
      "zemlju iz kartice dobavljača",
    );

    const applyResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/erp/articles/import") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Potvrdi atomski uvoz" }).click();
    const applyResponse = await applyResponsePromise;
    const applyPayload = await applyResponse.json();
    expect(applyResponse.ok(), JSON.stringify(applyPayload)).toBe(true);
    await expect(page.getByRole("status")).toContainText("Uvezeno artikala: 1");

    const imported = await db.product.findFirstOrThrow({
      where: { shortName: tag },
      select: {
        id: true,
        sku: true,
        countryOfOrigin: true,
        hsCode: true,
        stock: true,
        warehouseStocks: {
          where: { warehouse: { code: "DC" } },
          select: { qty: true },
        },
      },
    });
    importedProductId = imported.id;
    expect(imported.sku).toMatch(/^\d+$/);
    expect(imported).toMatchObject({
      countryOfOrigin: "CN",
      hsCode: "94032080",
      stock: 5,
      warehouseStocks: [{ qty: 5 }],
    });
    expect(runtimeErrors).toEqual([]);
  });
});

function createDatabaseClient() {
  const raw = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for article import acceptance.");
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
        connectionTimeoutMillis: 60_000,
      },
      { schema },
    ),
  });
}
