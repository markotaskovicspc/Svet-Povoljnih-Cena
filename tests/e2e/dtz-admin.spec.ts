import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("DTZ admin acceptance", () => {
  test.skip(
    process.env.E2E_DTZ_ADMIN !== "1",
    "Set E2E_DTZ_ADMIN=1 to run the isolated DTZ admin suite.",
  );

  test.setTimeout(360_000);
  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-DTZ-${runId}`;
  const adminEmail = `qa.dtz.${runId}@example.invalid`;
  const adminPassword = `QaDtz!${runId}x`;
  let db: PrismaClient;
  let productId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "DTZ",
      },
    });
    const product = await db.product.create({
      data: {
        sku: `QA-DTZ-${runId}`.slice(0, 80),
        slug: `qa-dtz-${runId}`,
        name: `${tag} artikal`,
        shortName: `${tag} artikal`,
        description: "QA DTZ opis",
        shortDescription: "QA DTZ opis",
        fullPrice: 1000,
        widthCm: 10,
        depthCm: 10,
        heightCm: 10,
        articleStatus: "UZ",
        isActive: false,
      },
    });
    productId = product.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      const admin = await db.adminUser.findUnique({
        where: { email: adminEmail },
        select: { id: true },
      });
      await db.product.deleteMany({
        where: {
          OR: [{ id: productId || "__missing__" }, { name: { startsWith: tag } }],
        },
      });
      if (admin) await db.auditLog.deleteMany({ where: { actorId: admin.id } });
      await db.rateLimitBucket.deleteMany({
        where: { key: { contains: adminEmail } },
      });
      await db.adminUser.deleteMany({ where: { email: adminEmail } });
    } finally {
      await db.$disconnect();
    }
  });

  test("saves DTZ without dates and warns about legacy XLSX columns", async ({
    page,
  }) => {
    await login(page);

    const statusSelect = page.getByLabel("Status artikla");
    await expect(statusSelect.locator('option[value="DTZ"]')).toHaveText(
      "DTZ — Dok traju zalihe",
    );
    await expect(
      page.getByText(
        "DTZ nema datum isteka. UZ je neobjavljen artikal u pripremi, a ARH je arhiviran.",
      ),
    ).toBeVisible();
    await expect(page.locator('input[name="tncFrom"]')).toHaveCount(0);
    await expect(page.locator('input[name="tncUntil"]')).toHaveCount(0);

    await statusSelect.selectOption("DTZ");
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(page.getByRole("status")).toContainText("Proizvod je sačuvan.", {
      timeout: 120_000,
    });
    await expect
      .poll(
        () =>
          db.product.findUniqueOrThrow({
            where: { id: productId },
            select: {
              articleStatus: true,
              isActive: true,
              isDtz: true,
              tncFrom: true,
              tncUntil: true,
            },
          }),
        { timeout: 120_000 },
      )
      .toEqual({
        articleStatus: "DTZ",
        isActive: true,
        isDtz: true,
        tncFrom: null,
        tncUntil: null,
      });

    await page.goto("/admin/erp/artikli/import", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText(/Za artikal „Dok traju zalihe“ unesite DTZ/),
    ).toBeVisible();
    await expect(
      page.getByText(/Stare kolone „T&C od“ i „T&C do“ više se ne koriste/),
    ).toBeVisible();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Artikli");
    sheet.addRow(["Kratki naziv", "Status", "T&C od", "T&C do"]);
    sheet.addRow([
      `${tag} XLSX`,
      "DTZ",
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-12-31T00:00:00Z"),
    ]);
    await page.getByLabel("XLSX datoteka").setInputFiles({
      name: `qa-dtz-${runId}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
    await page.getByRole("button", { name: "Prikaži preview" }).click();
    await expect(page.getByRole("status")).toContainText("Provera je uspešna", {
      timeout: 120_000,
    });
    await page.getByRole("button", { name: "Potvrdi atomski uvoz" }).click();
    const result = page.getByRole("status");
    await expect(result).toContainText("Uvezeno artikala: 1", {
      timeout: 120_000,
    });
    await expect(result).toContainText("Kolone T&C od/do su ignorisane");

    const imported = await db.product.findFirstOrThrow({
      where: { shortName: `${tag} XLSX` },
      select: {
        articleStatus: true,
        isDtz: true,
        tncFrom: true,
        tncUntil: true,
      },
    });
    expect(imported).toEqual({
      articleStatus: "DTZ",
      isDtz: true,
      tncFrom: null,
      tncUntil: null,
    });
  });

  async function login(page: Page) {
    const callbackUrl = `/admin/erp/artikli/${productId}`;
    await page.goto(
      `/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(new RegExp(`${callbackUrl}$`), {
      timeout: 180_000,
    });
  }
});

function createDatabaseClient() {
  const raw = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for DTZ acceptance.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 60_000,
    }),
  });
}
