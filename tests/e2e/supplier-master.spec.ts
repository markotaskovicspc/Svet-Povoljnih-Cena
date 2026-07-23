import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import ExcelJS from "exceljs";
import { createSupplierWithAutomaticCode } from "@/lib/admin/supplier-master.server";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("ERP module 2 supplier master acceptance", () => {
  test.skip(
    process.env.E2E_ADMIN_MUTATIONS !== "1",
    "Set E2E_ADMIN_MUTATIONS=1 to run the isolated supplier write-and-cleanup suite.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-SUPPLIER-${runId}`;
  const fixture = {
    adminEmail: `qa.supplier.${runId}@example.invalid`,
    adminPassword: `QaSupplier!${runId}x`,
    supplierName: `${tag} dobavljač`,
    seedSupplierName: `${tag} ponuđene lokacije`,
    seedSupplierCode: `QA-SEED-${runId}`.slice(0, 80),
    priceListCode: `QA-PL-${runId}`.slice(0, 80),
    priceListName: `${tag} cenovnik`,
    loadingLocations: [
      `${tag} Beograd`,
      `${tag} Šabac`,
      `${tag} Novi Sad`,
    ],
  };

  let db: PrismaClient;
  let adminId: string | null = null;
  let createdSupplierId: string | null = null;
  const concurrentSupplierIds = new Set<string>();
  const pageErrors: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();

    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash,
        role: "OPS",
        enabled: true,
        firstName: "QA",
        lastName: "Supplier",
      },
      select: { id: true },
    });
    adminId = admin.id;

    await db.priceList.create({
      data: {
        code: fixture.priceListCode,
        name: fixture.priceListName,
        kind: "PURCHASE",
        currency: "EUR",
        active: true,
        validFrom: new Date(),
      },
    });
    await db.supplier.create({
      data: {
        code: fixture.seedSupplierCode,
        name: fixture.seedSupplierName,
        loadingLocations: {
          create: fixture.loadingLocations.map((name, index) => ({
            name,
            position: index + 1,
            city: name.split(" ").at(-1),
            country: "RS",
          })),
        },
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

  test("migration backfill is valid SQL and fully rolls back", async () => {
    const rollbackMarker = `${tag}-ROLLBACK`;
    await expect(
      db.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({
          data: { name: rollbackMarker, code: null },
          select: { id: true },
        });
        await tx.$executeRaw`
          LOCK TABLE "Supplier" IN SHARE ROW EXCLUSIVE MODE
        `;
        await tx.$executeRaw`
          WITH "currentMax" AS (
            SELECT COALESCE(
              MAX(SUBSTRING("code" FROM '^DOB-([0-9]+)$')::INTEGER),
              0
            ) AS "lastValue"
            FROM "Supplier"
            WHERE "code" ~ '^DOB-[0-9]+$'
          ),
          "pending" AS (
            SELECT
              "id",
              ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "offset"
            FROM "Supplier"
            WHERE "code" IS NULL
          )
          UPDATE "Supplier" AS supplier
          SET "code" =
            'DOB-' ||
            LPAD(
              ("currentMax"."lastValue" + "pending"."offset")::TEXT,
              GREATEST(
                4,
                LENGTH(("currentMax"."lastValue" + "pending"."offset")::TEXT)
              ),
              '0'
            )
          FROM "pending", "currentMax"
          WHERE supplier."id" = "pending"."id"
        `;
        const updated = await tx.supplier.findUniqueOrThrow({
          where: { id: supplier.id },
          select: { code: true },
        });
        expect(updated.code).toMatch(/^DOB-\d{4,}$/);
        throw new Error("QA_EXPECTED_ROLLBACK");
      }),
    ).rejects.toThrow("QA_EXPECTED_ROLLBACK");

    await expect
      .poll(() => db.supplier.count({ where: { name: rollbackMarker } }))
      .toBe(0);
  });

  test("automatic numbering remains unique during concurrent creates", async () => {
    const suppliers = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createSupplierWithAutomaticCode((code) => ({
          name: `${tag} concurrency ${index + 1} ${code}`,
        })),
      ),
    );
    suppliers.forEach((supplier) => concurrentSupplierIds.add(supplier.id));

    const codes = suppliers.map((supplier) => supplier.code);
    expect(new Set(codes).size).toBe(suppliers.length);
    codes.forEach((code) => expect(code).toMatch(/^DOB-\d{4,}$/));

    await db.supplier.deleteMany({
      where: { id: { in: [...concurrentSupplierIds] } },
    });
    concurrentSupplierIds.clear();
  });

  test("real OPS admin completes full supplier CRUD and validation flow", async ({
    context,
    page,
  }) => {
    if (!adminId) throw new Error("QA admin fixture was not created.");
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);

    await test.step("module renders the exact requested commands and overview", async () => {
      await page.goto("/admin/erp/dobavljaci", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", {
          name: "Matični podaci o dobavljačima",
        }),
      ).toBeVisible();
      const commandBar = page.locator("div.flex.flex-wrap.gap-2").filter({
        has: page.getByRole("button", { name: "Unos novog", exact: true }),
      });
      await expect(
        commandBar.getByRole("button").evaluateAll((buttons) =>
          buttons.slice(0, 3).map((button) => button.textContent?.trim()),
        ),
      ).resolves.toEqual(["Unos novog", "Uredi", "Brisanje"]);

      const requestedHeaders = [
        "Šifra dobavljača",
        "Naziv dobavljača",
        "Adresa",
        "Grad",
        "Država",
        "Kontakt mail",
        "Telefon dobavljača",
        "Valuta",
        "Paritet",
        "Uslovi plaćanja",
        "Rok isporuke",
        "Tranzitno vreme",
        "Banka dobavljača",
        "SWIFT kod",
        "IBAN",
        "Cenovnik",
        "Mesto utovara 1",
        "Mesto utovara 2",
        "Mesto utovara 3",
      ];
      for (const header of requestedHeaders) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeAttached();
      }
      await expect(
        page.getByRole("columnheader").filter({
          has: page.getByRole("button", { name: "Kurs", exact: true }),
        }),
      ).toHaveCount(0);
    });

    await test.step("new supplier receives an immutable automatic code", async () => {
      await page.getByRole("button", { name: "Unos novog", exact: true }).click();
      await expect
        .poll(async () => {
          const audit = await db.auditLog.findFirst({
            where: {
              actorId: adminId!,
              action: "erp.command.supplier.create",
            },
            orderBy: { createdAt: "desc" },
            select: { entityId: true },
          });
          return audit?.entityId ?? null;
        })
        .not.toBeNull();
      const audit = await db.auditLog.findFirstOrThrow({
        where: {
          actorId: adminId!,
          action: "erp.command.supplier.create",
        },
        orderBy: { createdAt: "desc" },
        select: { entityId: true },
      });
      createdSupplierId = audit.entityId;
      if (!createdSupplierId) throw new Error("Create audit is missing supplier ID.");

      const created = await db.supplier.findUniqueOrThrow({
        where: { id: createdSupplierId },
        select: { code: true },
      });
      expect(created.code).toMatch(/^DOB-\d{4,}$/);
      await expect(
        page.getByRole("button", { name: "Završi uređivanje" }),
      ).toBeVisible();

      const row = page.locator("tbody tr").filter({ hasText: created.code! });
      await expect(row).toHaveCount(1);
      const codeCell = await cellFor(page, row, "Šifra dobavljača");
      await expect(codeCell.locator("button")).toBeDisabled();

      const immutableResponse = await page.request.patch(
        `/api/admin/erp/dobavljaci/rows/${createdSupplierId}`,
        {
          data: { columnKey: "code", value: "HACK-0001" },
        },
      );
      expect(immutableResponse.status()).toBe(422);
      await expect
        .poll(async () =>
          (
            await db.supplier.findUniqueOrThrow({
              where: { id: createdSupplierId! },
              select: { code: true },
            })
          ).code,
        )
        .toBe(created.code);
    });

    await test.step("server rejects every invalid controlled value", async () => {
      const invalidCases = [
        ["email", "bez-et", "Kontakt mail mora da sadrži @."],
        ["currency", "BTC", "Nepoznata valuta."],
        ["parity", "XYZ", "Izaberite paritet iz ponuđene liste."],
        ["deliveryDays", 1.5, "Rok isporuke mora biti ceo broj."],
        ["deliveryDays", -1, "Rok isporuke ne može biti negativan."],
        ["transitDays", 2.5, "Tranzitno vreme mora biti ceo broj."],
        ["transitDays", -1, "Tranzitno vreme ne može biti negativno."],
        ["defaultPriceList", "NE-POSTOJI", "ne postoji"],
        ["loading1", "Nepoznata lokacija", "ponuđenih vrednosti"],
      ] as const;

      for (const [columnKey, value, message] of invalidCases) {
        const response = await page.request.patch(
          `/api/admin/erp/dobavljaci/rows/${createdSupplierId}`,
          { data: { columnKey, value } },
        );
        expect(response.status(), columnKey).toBe(400);
        const payload = (await response.json()) as { error?: string };
        expect(payload.error, columnKey).toContain(message);
      }
    });

    await test.step("admin edits every requested field through the real grid", async () => {
      const supplier = await db.supplier.findUniqueOrThrow({
        where: { id: createdSupplierId! },
        select: { code: true },
      });
      const row = page.locator("tbody tr").filter({ hasText: supplier.code! });

      await setTextCell(page, row, "Naziv dobavljača", fixture.supplierName);
      await setTextCell(page, row, "Adresa", "QA Ulica 12");
      await setTextCell(page, row, "Grad", "Šabac");
      await setTextCell(page, row, "Država", "Srbija");

      const emailCell = await cellFor(page, row, "Kontakt mail");
      await emailCell.locator("button").click();
      await emailCell.locator("input").fill("neispravan-mail");
      await emailCell.locator("input").press("Enter");
      await expect(
        page.getByRole("alert").filter({
          hasText: "Kontakt mail mora da sadrži @.",
        }),
      ).toBeVisible();
      await setTextCell(
        page,
        row,
        "Kontakt mail",
        `nabavka.${runId}@example.invalid`,
      );
      await setTextCell(page, row, "Telefon dobavljača", "+381 15 555 123");
      await setSelectCell(page, row, "Valuta", "$");
      await setSelectCell(page, row, "Paritet", "CPT");
      await setTextCell(
        page,
        row,
        "Uslovi plaćanja",
        "30% avans, 70% pre isporuke",
      );
      await setTextCell(page, row, "Rok isporuke", "21");
      await setTextCell(page, row, "Tranzitno vreme", "4");
      await setTextCell(page, row, "Banka dobavljača", "QA Banka");
      await setTextCell(page, row, "SWIFT kod", "QABKRSBG");
      await setTextCell(page, row, "IBAN", "RS35105008123123123173");
      await setSelectCell(page, row, "Cenovnik", fixture.priceListCode);
      await setSelectCell(
        page,
        row,
        "Mesto utovara 1",
        fixture.loadingLocations[0],
      );
      await setSelectCell(
        page,
        row,
        "Mesto utovara 2",
        fixture.loadingLocations[1],
      );
      await setSelectCell(
        page,
        row,
        "Mesto utovara 3",
        fixture.loadingLocations[2],
      );

      const saved = await db.supplier.findUniqueOrThrow({
        where: { id: createdSupplierId! },
        select: {
          name: true,
          address: true,
          city: true,
          country: true,
          email: true,
          phone: true,
          currency: true,
          parity: true,
          paymentTerms: true,
          deliveryDays: true,
          transitDays: true,
          bank: true,
          swift: true,
          iban: true,
          defaultPriceList: { select: { code: true } },
          loadingLocations: {
            orderBy: { position: "asc" },
            select: { name: true, position: true },
          },
        },
      });
      expect({
        ...saved,
        defaultPriceList: saved.defaultPriceList?.code,
      }).toEqual({
        name: fixture.supplierName,
        address: "QA Ulica 12",
        city: "Šabac",
        country: "Srbija",
        email: `nabavka.${runId}@example.invalid`,
        phone: "+381 15 555 123",
        currency: "USD",
        parity: "CPT",
        paymentTerms: "30% avans, 70% pre isporuke",
        deliveryDays: 21,
        transitDays: 4,
        bank: "QA Banka",
        swift: "QABKRSBG",
        iban: "RS35105008123123123173",
        defaultPriceList: fixture.priceListCode,
        loadingLocations: fixture.loadingLocations.map((name, index) => ({
          name,
          position: index + 1,
        })),
      });
    });

    await test.step("reload, search and XLSX export retain all values", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      const search = page.getByPlaceholder("Brza pretraga po vidljivim kolonama");
      const filteredRowsResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/admin/erp/dobavljaci/rows" &&
          url.searchParams.get("q") === fixture.supplierName
        );
      });
      await search.fill(fixture.supplierName);
      await filteredRowsResponse;
      const row = page.locator("tbody tr").filter({ hasText: fixture.supplierName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(fixture.priceListCode);
      for (const location of fixture.loadingLocations) {
        await expect(row).toContainText(location);
      }

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Excel", exact: true }).click();
      const download = await downloadPromise;
      const filePath = await download.path();
      if (!filePath) throw new Error("XLSX download did not produce a file.");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      expect(worksheet.rowCount).toBe(2);
      expect(
        worksheet.getRow(1).values,
      ).toEqual([
        undefined,
        "Šifra dobavljača",
        "Naziv dobavljača",
        "Adresa",
        "Grad",
        "Država",
        "Kontakt mail",
        "Telefon dobavljača",
        "Valuta",
        "Paritet",
        "Uslovi plaćanja",
        "Rok isporuke",
        "Tranzitno vreme",
        "Banka dobavljača",
        "SWIFT kod",
        "IBAN",
        "Cenovnik",
        "Mesto utovara 1",
        "Mesto utovara 2",
        "Mesto utovara 3",
      ]);
      expect(worksheet.getRow(2).values).toContain(fixture.supplierName);
      expect(worksheet.getRow(2).values).toContain(fixture.priceListCode);
    });

    await test.step("cancelled delete is harmless, confirmed delete persists and audits", async () => {
      const row = page.locator("tbody tr").filter({ hasText: fixture.supplierName });
      await row.getByRole("checkbox").check();
      const deleteButton = page.getByRole("button", {
        name: "Brisanje (1)",
        exact: true,
      });
      const sortedRowsResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/admin/erp/dobavljaci/rows" &&
          url.searchParams.get("sorting")?.includes('"name"') === true
        );
      });
      await page.getByRole("button", {
        name: "Naziv dobavljača",
        exact: true,
      }).click();
      await sortedRowsResponse;
      await expect(row.getByRole("checkbox")).toBeChecked();
      await expect(deleteButton).toBeEnabled();

      await clickConfirmation(page, deleteButton, false);
      await expect(deleteButton).toBeEnabled();
      await expect
        .poll(() =>
          db.supplier.count({ where: { id: createdSupplierId! } }),
        )
        .toBe(1);
      await clickConfirmation(page, deleteButton, true);
      await expect
        .poll(() =>
          db.supplier.count({ where: { id: createdSupplierId! } }),
        )
        .toBe(0);
      await expect
        .poll(() =>
          db.auditLog.count({
            where: {
              actorId: adminId!,
              action: "erp.command.row.delete",
              entityId: createdSupplierId,
            },
          }),
        )
        .toBe(1);
      createdSupplierId = null;
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
    const existingAdmin = await db.adminUser.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true },
    });
    const actorId = adminId ?? existingAdmin?.id ?? null;
    const auditedSupplierIds = actorId
      ? (
          await db.auditLog.findMany({
            where: {
              actorId,
              entity: "erp:dobavljaci",
              entityId: { not: null },
            },
            select: { entityId: true },
          })
        )
          .map((entry) => entry.entityId)
          .filter((id): id is string => Boolean(id))
      : [];
    const supplierIds = [
      ...auditedSupplierIds,
      ...concurrentSupplierIds,
      ...(createdSupplierId ? [createdSupplierId] : []),
    ];
    if (supplierIds.length) {
      await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    }
    await db.supplier.deleteMany({
      where: {
        OR: [
          { name: { startsWith: tag } },
          { name: fixture.seedSupplierName },
          { code: fixture.seedSupplierCode },
        ],
      },
    });
    await db.priceList.deleteMany({
      where: { code: fixture.priceListCode },
    });
    if (actorId) await db.auditLog.deleteMany({ where: { actorId } });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({
      where: { email: fixture.adminEmail },
    });
    concurrentSupplierIds.clear();
    adminId = null;
    createdSupplierId = null;
  }
});

async function cellFor(
  page: Page,
  row: Locator,
  label: string,
) {
  const index = await page
    .getByRole("columnheader")
    .filter({
      has: page.getByRole("button", { name: label, exact: true }),
    })
    .evaluate((element) => (element as HTMLTableCellElement).cellIndex);
  return row.locator("td").nth(index);
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
  if (!raw) throw new Error("Database URL is required for supplier acceptance.");
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
