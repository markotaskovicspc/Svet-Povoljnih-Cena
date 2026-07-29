// Acceptance: STOCK-01
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("Modul 8 — Magacini", () => {
  test.skip(
    process.env.E2E_MODULE_8_WAREHOUSES !== "1" || !databaseUrl(),
    "Set E2E_MODULE_8_WAREHOUSES=1 and provide a database URL to run this isolated write-and-cleanup suite.",
  );
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.m8.admin.${runId}@example.invalid`,
    adminPassword: `QaM8Admin!${runId}`,
    firstName: `QA M8 Centralni ${runId}`,
    firstAddress: "Industrijska 12",
    firstCity: "Beograd",
    firstEmail: `CENTRALNI.${runId}@EXAMPLE.COM`,
    firstPhone: "+381 11 123 45 67",
    secondName: `QA M8 Novi Sad ${runId}`,
    secondAddress: "Bulevar Evrope 40",
    secondCity: "Novi Sad",
    secondEmail: `novi.sad.${runId}@example.com`,
    secondPhone: "021/555-444",
    updatedAddress: "Industrijska 14",
  };

  let db: PrismaClient;
  let adminId = "";
  const warehouseIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();
    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash,
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Modul 8",
      },
      select: { id: true },
    });
    adminId = admin.id;
  });

  test.afterAll(async () => {
    await cleanup();
    await db?.$disconnect();
  });

  test("pravi admin definiše, pronalazi i menja više magacina", async ({
    page,
    context,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const baseUrl =
      process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
    await context.addCookies([
      { name: "spc_cookie_consent", value: "essential", url: baseUrl },
    ]);

    await test.step("ruta je zaštićena i admin se prijavljuje", async () => {
      await page.goto("/admin/erp/magacini", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/admin\/prijava/);
      await page.getByLabel("E-pošta").fill(fixture.adminEmail);
      await page.getByLabel("Lozinka").fill(fixture.adminPassword);
      await page.getByRole("button", { name: "Prijavi se" }).click();
      await expect(page).toHaveURL(/\/admin\/erp\/magacini$/, {
        timeout: 90_000,
      });
      await expect(
        page.getByRole("heading", { name: "Magacini", exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("Tačka 8", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Novi magacin" }),
      ).toHaveCount(1);
    });

    await test.step("prikazane su tačno kolone iz zahteva klijenta", async () => {
      const headers = await page.locator("table").first().locator("thead th").allInnerTexts();
      expect(headers.map((header) => header.trim()).filter(Boolean)).toEqual([
        "Naziv",
        "Adresa",
        "Mesto",
        "E-mail",
        "Telefon",
      ]);
    });

    await test.step("browser i server odbijaju neispravan unos", async () => {
      await page.getByRole("button", { name: "Novi magacin" }).click();
      const dialog = page.getByRole("dialog", { name: "Novi magacin" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Naziv *").fill("Neispravan magacin");
      await dialog.getByLabel("E-mail").fill("nije-email");
      expect(
        await dialog.getByLabel("E-mail").evaluate(
          (input: HTMLInputElement) => input.checkValidity(),
        ),
      ).toBe(false);
      await dialog.getByRole("button", { name: "Odustani" }).click();

      const response = await page.request.post(
        "/api/admin/erp/magacini/commands",
        {
          data: {
            action: "warehouse.create",
            ids: [],
            input: {
              name: "Server invalid",
              email: "nije-email",
              phone: "123",
            },
          },
        },
      );
      expect(response.status()).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "Unesite ispravnu e-mail adresu.",
      });
      await expect
        .poll(() => db.warehouse.count({ where: { name: "Server invalid" } }))
        .toBe(0);
    });

    await test.step("admin kreira prvi magacin sa svih pet podataka", async () => {
      await createWarehouse(page, {
        name: `  ${fixture.firstName}  `,
        address: fixture.firstAddress,
        city: fixture.firstCity,
        email: `  ${fixture.firstEmail}  `,
        phone: fixture.firstPhone,
      });
      const first = await expect
        .poll(() =>
          db.warehouse.findFirst({
            where: { name: fixture.firstName },
          }),
        )
        .not.toBeNull();
      void first;
      const warehouse = await db.warehouse.findFirstOrThrow({
        where: { name: fixture.firstName },
      });
      warehouseIds.push(warehouse.id);
      expect(warehouse).toMatchObject({
        name: fixture.firstName,
        address: fixture.firstAddress,
        city: fixture.firstCity,
        email: fixture.firstEmail.toLowerCase(),
        phone: fixture.firstPhone,
        active: true,
      });
      expect(warehouse.code).toMatch(/^MAG-\d{3,}$/);
    });

    await test.step("admin kreira i drugi magacin", async () => {
      await createWarehouse(page, {
        name: fixture.secondName,
        address: fixture.secondAddress,
        city: fixture.secondCity,
        email: fixture.secondEmail,
        phone: fixture.secondPhone,
      });
      const warehouse = await expect
        .poll(() =>
          db.warehouse.findFirst({
            where: { name: fixture.secondName },
          }),
        )
        .not.toBeNull();
      void warehouse;
      const second = await db.warehouse.findFirstOrThrow({
        where: { name: fixture.secondName },
      });
      warehouseIds.push(second.id);
      expect(second.active).toBe(true);
      expect(second.code).not.toBe(
        (
          await db.warehouse.findFirstOrThrow({
            where: { name: fixture.firstName },
          })
        ).code,
      );
      await expect(page.getByText(fixture.firstName, { exact: true })).toBeVisible();
      await expect(page.getByText(fixture.secondName, { exact: true })).toBeVisible();
    });

    await test.step("pretraga i inline izmena rade i posle osvežavanja", async () => {
      const search = page.getByPlaceholder("Brza pretraga po vidljivim kolonama");
      await search.fill(fixture.secondCity);
      await expect(page.getByText(fixture.secondName, { exact: true })).toBeVisible();
      await expect(page.getByText(fixture.firstName, { exact: true })).toBeHidden();
      await search.clear();

      await page.getByRole("button", { name: "Uredi podržana polja" }).click();
      const firstRow = warehouseRow(page, fixture.firstName);
      await firstRow
        .getByRole("button", { name: fixture.firstAddress, exact: true })
        .click();
      const addressInput = firstRow.getByLabel("Izmeni Adresa");
      await addressInput.fill(fixture.updatedAddress);
      await addressInput.press("Enter");
      await expect
        .poll(async () =>
          (
            await db.warehouse.findFirstOrThrow({
              where: { name: fixture.firstName },
              select: { address: true },
            })
          ).address,
        )
        .toBe(fixture.updatedAddress);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        warehouseRow(page, fixture.firstName).getByText(
          fixture.updatedAddress,
          { exact: true },
        ),
      ).toBeVisible();
    });

    await test.step("Excel izvoz i audit trag su dostupni adminu", async () => {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Excel" }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe("magacini.xlsx");
      expect((await file.createReadStream()) !== null).toBe(true);

      await expect
        .poll(() =>
          db.auditLog.count({
            where: {
              actorId: adminId,
              entity: "erp:magacini",
              action: {
                in: ["erp.command.warehouse.create", "erp.cell.update"],
              },
            },
          }),
        )
        .toBeGreaterThanOrEqual(3);
    });

    expect(pageErrors).toEqual([]);
  });

  async function cleanup() {
    if (!db) return;
    const existingAdmin = await db.adminUser.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true },
    });
    const actorId = adminId || existingAdmin?.id;
    if (actorId) {
      const createdIds = await db.auditLog.findMany({
        where: {
          actorId,
          entity: "erp:magacini",
          action: "erp.command.warehouse.create",
          entityId: { not: null },
        },
        select: { entityId: true },
      });
      warehouseIds.push(
        ...createdIds
          .map((entry) => entry.entityId)
          .filter((id): id is string => Boolean(id)),
      );
      await db.auditLog.deleteMany({ where: { actorId } });
    }
    const uniqueWarehouseIds = Array.from(new Set(warehouseIds));
    if (uniqueWarehouseIds.length) {
      await db.warehouse.deleteMany({ where: { id: { in: uniqueWarehouseIds } } });
    }
    await db.warehouse.deleteMany({
      where: {
        name: {
          in: [fixture.firstName, fixture.secondName, "Server invalid"],
        },
      },
    });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
    adminId = "";
    warehouseIds.length = 0;
  }
});

async function createWarehouse(
  page: Page,
  values: {
    name: string;
    address: string;
    city: string;
    email: string;
    phone: string;
  },
) {
  await page.getByRole("button", { name: "Novi magacin" }).click();
  const dialog = page.getByRole("dialog", { name: "Novi magacin" });
  await dialog.getByLabel("Naziv *").fill(values.name);
  await dialog.getByLabel("Adresa").fill(values.address);
  await dialog.getByLabel("Mesto").fill(values.city);
  await dialog.getByLabel("E-mail").fill(values.email);
  await dialog.getByLabel("Telefon").fill(values.phone);
  await dialog.getByRole("button", { name: "Novi magacin" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(`Magacin „${values.name.trim()}” je kreiran.`, {
      exact: true,
    }),
  ).toBeVisible();
}

function warehouseRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({
    has: page.getByText(name, { exact: true }),
  });
}

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("Database URL is required for Modul 8 acceptance.");
  const url = new URL(raw);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!isLocal && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
    throw new Error(
      "Remote Modul 8 acceptance requires E2E_ALLOW_REMOTE_DATABASE=1.",
    );
  }
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (!isLocal && (!sslMode || ["prefer", "require", "verify-ca"].includes(sslMode))) {
    url.searchParams.set("sslmode", sslMode || "require");
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
