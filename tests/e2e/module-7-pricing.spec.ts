import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("Modul 7 — admin pricing acceptance", () => {
  test.skip(
    process.env.E2E_MODULE_7_PRICING !== "1" || !hasLocalDatabaseUrl(),
    "Set E2E_MODULE_7_PRICING=1 and use a localhost database to run this isolated write-and-cleanup suite.",
  );
  test.setTimeout(300_000);

  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-M7-${runId}`;
  const slugBase = `qa-m7-${runId}`;
  const fixture = {
    adminEmail: `qa.m7.admin.${runId}@example.invalid`,
    adminPassword: `QaM7Admin!${runId}`,
    customerEmail: `qa.m7.customer.${runId}@example.invalid`,
    customerPassword: `QaM7Customer!${runId}`,
    supplier: `${tag} dobavljač`,
    group: `${tag} grupa`,
    collection: `${tag} kolekcija`,
    category: `${tag} kategorija`,
    subcategory: `${tag} podgrupa`,
    actionSku: `M7-A-${runId}`.slice(0, 80),
    loyaltySku: `M7-L-${runId}`.slice(0, 80),
    actionSlug: `${slugBase}-akcijski-artikal`,
    loyaltySlug: `${slugBase}-loyalty-artikal`,
    lowAction: `${tag} niži prioritet`,
    highAction: `${tag} Heroji meseca`,
    disposableAction: `${tag} za brisanje`,
    invalidAction: `${tag} neispravan period`,
    loyaltyOld: `${tag} loyalty istorija 4%`,
    loyaltyActive: `${tag} loyalty aktivan 5%`,
    loyaltyEditable: `${tag} loyalty upravljanje`,
    linearAll: `${tag} ceo asortiman 2%`,
    linearGroup: `${tag} grupa 6%`,
    linearCategory: `${tag} kategorija 10%`,
    linearEditable: `${tag} linearno upravljanje`,
    mpPriceListCode: `QA-MP-${runId}`.slice(0, 60),
  };

  let db: PrismaClient;
  const created = {
    adminId: "",
    userId: "",
    supplierId: "",
    groupId: "",
    collectionId: "",
    categoryId: "",
    subcategoryId: "",
    actionProductId: "",
    loyaltyProductId: "",
    priceListId: "",
    warehouseId: "",
    createdWarehouse: false,
  };

  const now = new Date();
  const startsAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const startsLocal = dateTimeLocal(startsAt);
  const endsLocal = dateTimeLocal(endsAt);
  const invalidEndsLocal = dateTimeLocal(
    new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
  );

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();

    const [adminHash, customerHash] = await Promise.all([
      bcrypt.hash(fixture.adminPassword, 12),
      bcrypt.hash(fixture.customerPassword, 12),
    ]);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash: adminHash,
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Modul 7",
      },
      select: { id: true },
    });
    created.adminId = admin.id;

    const user = await db.user.create({
      data: {
        email: fixture.customerEmail,
        emailVerified: new Date(),
        passwordHash: customerHash,
        firstName: "QA",
        lastName: "Kupac Modul 7",
        name: "QA Kupac Modul 7",
      },
      select: { id: true },
    });
    created.userId = user.id;

    const supplier = await db.supplier.create({
      data: {
        name: fixture.supplier,
        code: `M7-${runId}`.slice(0, 40),
      },
      select: { id: true },
    });
    created.supplierId = supplier.id;

    const group = await db.group.create({
      data: { name: fixture.group, slug: `${slugBase}-grupa` },
      select: { id: true },
    });
    created.groupId = group.id;

    const collection = await db.collection.create({
      data: { name: fixture.collection, slug: `${slugBase}-kolekcija` },
      select: { id: true },
    });
    created.collectionId = collection.id;

    const category = await db.category.create({
      data: {
        name: fixture.category,
        slug: `${slugBase}-kategorija`,
        path: `/${slugBase}-kategorija`,
        level: 0,
      },
      select: { id: true, path: true },
    });
    created.categoryId = category.id;

    const subcategory = await db.category.create({
      data: {
        name: fixture.subcategory,
        slug: `${slugBase}-podgrupa`,
        path: `${category.path}/${slugBase}-podgrupa`,
        level: 1,
        parentId: category.id,
      },
      select: { id: true },
    });
    created.subcategoryId = subcategory.id;

    let warehouse = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      select: { id: true },
    });
    if (!warehouse) {
      warehouse = await db.warehouse.create({
        data: {
          code: `QA-M7-${runId}`.slice(0, 40),
          name: `${tag} magacin`,
          active: true,
          isDefault: true,
        },
        select: { id: true },
      });
      created.createdWarehouse = true;
    }
    created.warehouseId = warehouse.id;

    const actionProduct = await db.product.create({
      data: {
        sku: fixture.actionSku,
        slug: fixture.actionSlug,
        name: `${tag} Kratki naziv akcijskog artikla`,
        description: "Privremeni Modul 7 acceptance artikal.",
        shortDescription: `${tag} kratki opis`,
        fullPrice: 1000,
        widthCm: 10,
        depthCm: 20,
        heightCm: 30,
        stock: 20,
        isActive: true,
        supplierId: supplier.id,
        groupId: group.id,
        collectionId: collection.id,
        attribute1: "M7 atribut jedan",
        attribute2: "M7 atribut dva",
        attribute3: "M7 atribut tri",
        attribute4: "M7 atribut četiri",
        colorPrimary: "M7 plava",
        colorSecondary: "M7 siva",
        categories: {
          create: [
            { categoryId: category.id },
            { categoryId: subcategory.id },
          ],
        },
        warehouseStocks: {
          create: { warehouseId: warehouse.id, qty: 20 },
        },
        media: {
          create: {
            kind: "IMAGE",
            url: "/logo.jpeg",
            alt: `${tag} slika`,
          },
        },
      },
      select: { id: true },
    });
    created.actionProductId = actionProduct.id;

    const loyaltyProduct = await db.product.create({
      data: {
        sku: fixture.loyaltySku,
        slug: fixture.loyaltySlug,
        name: `${tag} Loyalty artikal`,
        description: "Privremeni Modul 7 loyalty acceptance artikal.",
        shortDescription: `${tag} loyalty opis`,
        fullPrice: 1000,
        widthCm: 10,
        depthCm: 20,
        heightCm: 30,
        stock: 20,
        isActive: true,
        supplierId: supplier.id,
        groupId: group.id,
        collectionId: collection.id,
        categories: {
          create: [
            { categoryId: category.id },
            { categoryId: subcategory.id },
          ],
        },
        warehouseStocks: {
          create: { warehouseId: warehouse.id, qty: 20 },
        },
        media: {
          create: {
            kind: "IMAGE",
            url: "/logo.jpeg",
            alt: `${tag} loyalty slika`,
          },
        },
      },
      select: { id: true },
    });
    created.loyaltyProductId = loyaltyProduct.id;

    const priceList = await db.priceList.create({
      data: {
        code: fixture.mpPriceListCode,
        name: `${tag} *MP`,
        kind: "RETAIL",
        currency: "RSD",
        active: true,
        validFrom: new Date(startsAt.getTime() - 7 * 24 * 60 * 60 * 1000),
        validTo: new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        entries: {
          create: [
            {
              productId: actionProduct.id,
              price: 1000,
              validFrom: new Date(
                startsAt.getTime() - 3 * 24 * 60 * 60 * 1000,
              ),
            },
            {
              productId: actionProduct.id,
              price: 1500,
              validFrom: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
            },
            {
              productId: loyaltyProduct.id,
              price: 1000,
              validFrom: new Date(
                startsAt.getTime() - 3 * 24 * 60 * 60 * 1000,
              ),
            },
          ],
        },
      },
      select: { id: true },
    });
    created.priceListId = priceList.id;
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("administrator prolazi ceo Modul 7, a prodavnica koristi ista pravila", async ({
    browser,
    context,
    page,
  }) => {
    const formActionWarnings: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /formaction.*(?:name|value)|(?:name|value).*formaction|function.*formaction/i.test(
          message.text(),
        )
      ) {
        formActionWarnings.push(message.text());
      }
    });
    const baseUrl =
      process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
    await context.addCookies([
      { name: "spc_cookie_consent", value: "essential", url: baseUrl },
    ]);

    await test.step("zaštita rute i administratorska prijava", async () => {
      await page.goto("/admin/akcije", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/admin\/prijava/);

      await page.getByLabel("E-pošta").fill(fixture.adminEmail);
      await page.getByLabel("Lozinka").fill("pogresna-lozinka");
      await page.getByRole("button", { name: "Prijavi se" }).click();
      await expect(page).toHaveURL(/\/admin\/prijava\?error=1/);

      await page.getByLabel("E-pošta").fill(fixture.adminEmail);
      await page.getByLabel("Lozinka").fill(fixture.adminPassword);
      await page.getByRole("button", { name: "Prijavi se" }).click();
      await expect(page).toHaveURL(/\/admin\/akcije$/);
      await expect(
        page.getByRole("heading", { name: "Akcije", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Program lojalnosti")).toBeVisible();
      await expect(page.getByText("Linearni popust na asortiman")).toBeVisible();
    });

    await test.step("neispravan period se odbija bez upisa", async () => {
      await page.getByRole("button", { name: "Nova akcija" }).click();
      const form = actionForm(page);
      await fillActionForm(form, {
        name: fixture.invalidAction,
        slug: `${slugBase}-neispravan-period`,
        kind: "AKCIJA",
        startsAt: startsLocal,
        endsAt: invalidEndsLocal,
        priority: 10,
      });
      await form.getByRole("button", { name: "Dodaj akciju" }).click();
      await expect
        .poll(() =>
          db.action.count({ where: { name: fixture.invalidAction } }),
        )
        .toBe(0);
      await expect
        .poll(() =>
          db.auditLog.count({
            where: {
              actorId: created.adminId,
              action: "action.upsert.error",
            },
          }),
        )
        .toBe(1);
      await expect(
        form.getByRole("alert"),
      ).toContainText("Datum završetka mora biti posle datuma početka.");
    });

    await test.step("kreiranje, izbor i izmena dve akcije", async () => {
      await createAction(page, {
        name: fixture.lowAction,
        slug: `${slugBase}-nizi`,
        kind: "AKCIJA",
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 1_999_999_900,
      });
      await expect(
        page.getByText(`Akcija: ${fixture.lowAction}`, { exact: true }),
      ).toBeVisible();
      await expect(actionForm(page).locator('input[name="name"]')).toHaveValue(
        fixture.lowAction,
      );
      await createAction(page, {
        name: fixture.highAction,
        slug: `${slugBase}-heroji`,
        kind: "HEROJI",
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 2_000_000_000,
        isHero: true,
      });

      const lowRow = actionRow(page, fixture.lowAction);
      const highRow = actionRow(page, fixture.highAction);
      await expect(lowRow).toBeVisible();
      await expect(highRow).toBeVisible();

      await lowRow.click();
      await expect(actionForm(page).locator('input[name="name"]')).toHaveValue(
        fixture.lowAction,
      );
      await highRow.click();
      await expect(actionForm(page).locator('input[name="name"]')).toHaveValue(
        fixture.highAction,
      );
      await expect(actionForm(page).getByLabel("Glavna akcija")).toBeChecked();

      const highForm = actionForm(page);
      await highForm.locator('input[name="sortOrder"]').fill("17");
      await highForm.getByRole("button", { name: "Sačuvaj izmene" }).click();
      await expect
        .poll(async () => {
          const action = await db.action.findUnique({
            where: { slug: `${slugBase}-heroji` },
            select: { kind: true, isHero: true, priority: true, sortOrder: true },
          });
          return action;
        })
        .toEqual({
          kind: "HEROJI",
          isHero: true,
          priority: 2_000_000_000,
          sortOrder: 17,
        });
    });

    await test.step("dupli klik, nepostojeći SKU i automatska polja sa MP cenom na datum", async () => {
      await actionRow(page, fixture.lowAction).dblclick();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Artikli na akciji: ${fixture.lowAction}`);
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox?.width ?? 0).toBeGreaterThan(1_000);

      const skuInput = dialog.locator(
        'input[name="sku"][form="add-action-product"]',
      );
      await skuInput.fill(`${fixture.actionSku}-NEPOSTOJI`);
      await dialog.getByRole("button", { name: "Popuni podatke" }).click();
      await expect(dialog).toContainText("nije pronađen");

      await skuInput.fill(fixture.actionSku);
      await skuInput.press("Enter");
      for (const value of [
        fixture.supplier,
        fixture.category,
        fixture.subcategory,
        fixture.group,
        fixture.collection,
        `${tag} kratki opis`,
        `${tag} Kratki naziv akcijskog artikla`,
        "M7 atribut jedan",
        "M7 atribut dva",
        "M7 atribut tri",
        "M7 atribut četiri",
        "M7 plava",
        "M7 siva",
      ]) {
        await expect(dialog.getByText(value, { exact: true })).toBeVisible();
      }
      await expect(dialog).toContainText(/1[.\s]000(?:,00)?\s*RSD/);

      await dialog
        .locator('input[name="salePrice"][form="add-action-product"]')
        .fill("900");
      await dialog.getByRole("button", { name: "Dodaj", exact: true }).click();
      await expect
        .poll(async () => {
          const action = await db.action.findUniqueOrThrow({
            where: { slug: `${slugBase}-nizi` },
            select: { id: true },
          });
          const row = await db.actionProduct.findUnique({
            where: {
              actionId_productId: {
                actionId: action.id,
                productId: created.actionProductId,
              },
            },
            select: { salePrice: true },
          });
          return row ? Number(row.salePrice) : null;
        })
        .toBe(900);
    });

    await test.step("izmena, upsert i potvrđeno uklanjanje artikla", async () => {
      const dialog = page.getByRole("dialog");
      const productRow = dialog
        .locator("tbody tr")
        .filter({ hasText: fixture.actionSku });
      await expect(productRow).toBeVisible();
      await productRow.locator('input[name="salePrice"]').fill("875");
      await productRow.getByRole("button", { name: "Sačuvaj" }).click();
      await expect
        .poll(() => actionPrice(`${slugBase}-nizi`))
        .toBe(875);

      const skuInput = dialog.locator(
        'input[name="sku"][form="add-action-product"]',
      );
      await skuInput.fill(fixture.actionSku);
      await skuInput.press("Enter");
      await dialog
        .locator('input[name="salePrice"][form="add-action-product"]')
        .fill("850");
      await dialog.getByRole("button", { name: "Dodaj", exact: true }).click();
      await expect.poll(() => actionPrice(`${slugBase}-nizi`)).toBe(850);
      await expect
        .poll(() =>
          db.actionProduct.count({
            where: {
              action: { slug: `${slugBase}-nizi` },
              productId: created.actionProductId,
            },
          }),
        )
        .toBe(1);

      await clickConfirmation(
        page,
        productRow.getByRole("button", { name: "Ukloni" }),
        false,
      );
      await expect.poll(() => actionPrice(`${slugBase}-nizi`)).toBe(850);
      await clickConfirmation(
        page,
        productRow.getByRole("button", { name: "Ukloni" }),
        true,
      );
      await expect.poll(() => actionPrice(`${slugBase}-nizi`)).toBeNull();

      await skuInput.fill(fixture.actionSku);
      await skuInput.press("Enter");
      await dialog
        .locator('input[name="salePrice"][form="add-action-product"]')
        .fill("900");
      await dialog.getByRole("button", { name: "Dodaj", exact: true }).click();
      await expect.poll(() => actionPrice(`${slugBase}-nizi`)).toBe(900);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });

    await test.step("isti artikal u akciji višeg prioriteta", async () => {
      await actionRow(page, fixture.highAction).press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const skuInput = dialog.locator(
        'input[name="sku"][form="add-action-product"]',
      );
      await skuInput.fill(fixture.actionSku);
      await skuInput.press("Enter");
      await dialog
        .locator('input[name="salePrice"][form="add-action-product"]')
        .fill("800");
      await dialog.getByRole("button", { name: "Dodaj", exact: true }).click();
      await expect.poll(() => actionPrice(`${slugBase}-heroji`)).toBe(800);
      await page.keyboard.press("Escape");
    });

    await test.step("loyalty istorija čuva staro i aktivno pravilo", async () => {
      const form = loyaltyForm(page);
      await fillLoyaltyForm(form, {
        name: fixture.loyaltyOld,
        discountPct: 4,
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 1_999_999_800,
        active: false,
      });
      await form.getByRole("button", { name: "Dodaj u istoriju" }).click();
      await expect
        .poll(() =>
          db.loyaltyRule.count({ where: { name: fixture.loyaltyOld } }),
        )
        .toBe(1);

      await fillLoyaltyForm(loyaltyForm(page), {
        name: fixture.loyaltyActive,
        discountPct: 5,
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 2_000_000_000,
        active: true,
      });
      await loyaltyForm(page)
        .getByRole("button", { name: "Dodaj u istoriju" })
        .click();
      await expect
        .poll(async () => {
          const rules = await db.loyaltyRule.findMany({
            where: { name: { startsWith: tag } },
            select: { name: true, discountPct: true, active: true },
            orderBy: { priority: "asc" },
          });
          return rules.map((rule) => ({
            name: rule.name,
            discountPct: Number(rule.discountPct),
            active: rule.active,
          }));
        })
        .toEqual([
          { name: fixture.loyaltyOld, discountPct: 4, active: false },
          { name: fixture.loyaltyActive, discountPct: 5, active: true },
        ]);
      await expect(page.getByText(fixture.loyaltyOld, { exact: true })).toBeVisible();
      await expect(
        page.getByText(fixture.loyaltyActive, { exact: true }),
      ).toBeVisible();
    });

    await test.step("loyalty može da se menja, aktivira, deaktivira i briše uz očuvanu istoriju", async () => {
      await fillLoyaltyForm(loyaltyForm(page), {
        name: fixture.loyaltyEditable,
        discountPct: 3,
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 1_999_999_700,
        active: false,
      });
      await loyaltyForm(page)
        .getByRole("button", { name: "Dodaj u istoriju" })
        .click();
      await expect
        .poll(() =>
          db.loyaltyRule.count({ where: { name: fixture.loyaltyEditable } }),
        )
        .toBe(1);

      const historyRow = page
        .locator("tr")
        .filter({ hasText: fixture.loyaltyEditable })
        .first();
      await historyRow.getByRole("button", { name: "Izmeni" }).click();
      let editForm = page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "Sačuvaj pravilo" }) });
      await editForm.locator('input[name="discountPct"]').fill("7");
      await editForm.getByLabel("Aktivno").check();
      await editForm.getByRole("button", { name: "Sačuvaj pravilo" }).click();
      await expect
        .poll(async () => {
          const rows = await db.loyaltyRule.findMany({
            where: { name: fixture.loyaltyEditable },
            select: { discountPct: true, active: true },
            orderBy: { discountPct: "asc" },
          });
          return rows.map((row) => ({
            discountPct: Number(row.discountPct),
            active: row.active,
          }));
        })
        .toEqual([
          { discountPct: 3, active: false },
          { discountPct: 7, active: true },
        ]);

      editForm = page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "Sačuvaj pravilo" }) });
      await editForm.getByLabel("Aktivno").uncheck();
      await editForm.getByRole("button", { name: "Sačuvaj pravilo" }).click();
      await expect
        .poll(() =>
          db.loyaltyRule.count({
            where: {
              name: fixture.loyaltyEditable,
              discountPct: 7,
              active: false,
            },
          }),
        )
        .toBe(1);

      await clickConfirmation(
        page,
        page.getByRole("button", { name: "Obriši zapis" }),
        true,
      );
      await expect
        .poll(() =>
          db.loyaltyRule.count({ where: { name: fixture.loyaltyEditable } }),
        )
        .toBe(1);
    });

    await test.step("linearni popust za ceo asortiman, grupu i kategoriju", async () => {
      await createLinearPromotion(page, {
        name: fixture.linearAll,
        discountPct: 2,
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 1_999_999_700,
      });
      await createLinearPromotion(page, {
        name: fixture.linearGroup,
        discountPct: 6,
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 1_999_999_800,
        groupLabel: fixture.group,
      });
      await createLinearPromotion(page, {
        name: fixture.linearCategory,
        discountPct: 10,
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 2_000_000_000,
        categoryLabel: fixture.category,
      });

      const promotions = await db.linearPromotion.findMany({
        where: { name: { startsWith: tag } },
        include: { categories: true, groups: true },
      });
      expect(
        promotions
          .map((promotion) => ({
            name: promotion.name,
            target: promotion.target,
            categories: promotion.categories.length,
            groups: promotion.groups.length,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ).toEqual(
        [
          {
            name: fixture.linearAll,
            target: "ALL",
            categories: 0,
            groups: 0,
          },
          {
            name: fixture.linearCategory,
            target: "CATEGORY",
            categories: 1,
            groups: 0,
          },
          {
            name: fixture.linearGroup,
            target: "GROUP",
            categories: 0,
            groups: 1,
          },
        ].sort((left, right) => left.name.localeCompare(right.name)),
      );
      await expect(page.getByText("Ceo asortiman", { exact: true })).toBeVisible();
    });

    await test.step("linearna promocija može da se menja, aktivira, deaktivira i briše", async () => {
      const form = linearForm(page);
      await form.locator('input[name="name"]').fill(fixture.linearEditable);
      await form.locator('input[name="discountPct"]').fill("3");
      await form.locator('input[name="startsAt"]').fill(startsLocal);
      await form.locator('input[name="endsAt"]').fill(endsLocal);
      await form.locator('input[name="priority"]').fill("1999999600");
      await form.getByRole("button", { name: "Dodaj promociju" }).click();
      await expect
        .poll(() =>
          db.linearPromotion.count({
            where: { name: fixture.linearEditable, active: false },
          }),
        )
        .toBe(1);

      const promotionRow = page
        .locator("tr")
        .filter({ hasText: fixture.linearEditable });
      await promotionRow.getByRole("button", { name: "Izmeni" }).click();
      let editForm = page
        .locator("form")
        .filter({
          has: page.getByRole("button", { name: "Sačuvaj promociju" }),
        });
      await editForm.locator('input[name="discountPct"]').fill("8");
      await editForm.getByLabel(fixture.group, { exact: true }).check();
      await editForm.getByLabel("Aktivna").check();
      await editForm.getByRole("button", { name: "Sačuvaj promociju" }).click();
      await expect
        .poll(async () => {
          const promotion = await db.linearPromotion.findFirst({
            where: { name: fixture.linearEditable },
            select: {
              discountPct: true,
              active: true,
              groups: { select: { groupId: true } },
            },
          });
          return promotion
            ? {
                discountPct: Number(promotion.discountPct),
                active: promotion.active,
                groupIds: promotion.groups.map((group) => group.groupId),
              }
            : null;
        })
        .toEqual({
          discountPct: 8,
          active: true,
          groupIds: [created.groupId],
        });

      editForm = page
        .locator("form")
        .filter({
          has: page.getByRole("button", { name: "Sačuvaj promociju" }),
        });
      await editForm.getByLabel("Aktivna").uncheck();
      await editForm.getByRole("button", { name: "Sačuvaj promociju" }).click();
      await expect
        .poll(() =>
          db.linearPromotion.count({
            where: { name: fixture.linearEditable, active: false },
          }),
        )
        .toBe(1);

      await clickConfirmation(
        page,
        page.getByRole("button", { name: "Obriši promociju" }),
        true,
      );
      await expect
        .poll(() =>
          db.linearPromotion.count({ where: { name: fixture.linearEditable } }),
        )
        .toBe(0);
    });

    await test.step("brisanje akcije traži potvrdu i zaista briše", async () => {
      await createAction(page, {
        name: fixture.disposableAction,
        slug: `${slugBase}-brisanje`,
        kind: "CUSTOM",
        startsAt: startsLocal,
        endsAt: endsLocal,
        priority: 1,
      });
      await actionRow(page, fixture.disposableAction).click();
      const deleteButton = actionForm(page).getByRole("button", {
        name: "Obriši",
      });
      await clickConfirmation(page, deleteButton, false);
      await expect
        .poll(() =>
          db.action.count({ where: { slug: `${slugBase}-brisanje` } }),
        )
        .toBe(1);
      await clickConfirmation(page, deleteButton, true);
      await expect
        .poll(() =>
          db.action.count({ where: { slug: `${slugBase}-brisanje` } }),
        )
        .toBe(0);
    });

    await test.step("gost vidi prioritet akcije i linearni popust", async () => {
      const guestContext = await browser.newContext();
      try {
        await guestContext.addCookies([
          { name: "spc_cookie_consent", value: "essential", url: baseUrl },
        ]);
        const guestPage = await guestContext.newPage();

        await guestPage.goto(`/p/${fixture.actionSlug}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(
          guestPage.getByRole("heading", {
            name: `${tag} Kratki naziv akcijskog artikla`,
          }),
        ).toBeVisible();
        const actionPdp = guestPage.getByRole("article").filter({
          has: guestPage.getByRole("heading", {
            name: `${tag} Kratki naziv akcijskog artikla`,
          }),
        });
        await expect(guestPage.getByText("Akcijska cena", { exact: true })).toBeVisible();
        await expect(actionPdp).toContainText(
          /720(?:[.,]00)?\s*RSD/,
        );

        await guestPage.goto(`/p/${fixture.loyaltySlug}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(guestPage.getByText("Akcijska cena", { exact: true })).toBeVisible();
        const loyaltyGuestPdp = guestPage.getByRole("article").filter({
          has: guestPage.getByRole("heading", {
            name: `${tag} Loyalty artikal`,
          }),
        });
        await expect(loyaltyGuestPdp).toContainText(
          /900(?:[.,]00)?\s*RSD/,
        );
      } finally {
        await guestContext.close();
      }
    });

    await test.step("ulogovan kupac dobija loyalty pa linearni popust, a korpa čuva cenu", async () => {
      const customerContext = await browser.newContext();
      try {
        await customerContext.addCookies([
          { name: "spc_cookie_consent", value: "essential", url: baseUrl },
        ]);
        const customerPage = await customerContext.newPage();
        await customerPage.goto(
          `/nalog/prijava?callbackUrl=${encodeURIComponent(`/p/${fixture.loyaltySlug}`)}`,
          { waitUntil: "domcontentloaded" },
        );
        await customerPage.getByLabel("E-pošta").fill(fixture.customerEmail);
        await customerPage.getByLabel("Lozinka").fill(fixture.customerPassword);
        await customerPage
          .getByRole("main")
          .getByRole("button", { name: "Prijavi se", exact: true })
          .click();
        await expect(customerPage).toHaveURL(
          new RegExp(`/p/${fixture.loyaltySlug}$`),
        );
        await expect(
          customerPage.getByText("Loyalty cena", { exact: true }),
        ).toBeVisible();
        const loyaltyCustomerPdp = customerPage.getByRole("article").filter({
          has: customerPage.getByRole("heading", {
            name: `${tag} Loyalty artikal`,
          }),
        });
        await expect(loyaltyCustomerPdp).toContainText(
          /855(?:[.,]00)?\s*RSD/,
        );

        await customerPage
          .getByRole("button", { name: "Dodaj u korpu" })
          .first()
          .click();
        await customerPage.goto("/korpa", { waitUntil: "domcontentloaded" });
        await expect(
          customerPage.getByText(`${tag} Loyalty artikal`, { exact: true }),
        ).toBeVisible();
        await expect(
          customerPage.getByLabel("Stavke u korpi"),
        ).toContainText(/855(?:[.,]00)?\s*RSD/);
      } finally {
        await customerContext.close();
      }
    });

    await test.step("mobilni prikaz ostaje upotrebljiv", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/admin/akcije", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Nova akcija" })).toBeVisible();
      await expect(actionRow(page, fixture.highAction)).toBeVisible();
      await actionRow(page, fixture.highAction).press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page
          .getByRole("dialog")
          .locator('input[name="sku"][form="add-action-product"]'),
      ).toBeVisible();
      const mobileDialogBox = await page.getByRole("dialog").boundingBox();
      expect(mobileDialogBox?.width ?? 400).toBeLessThanOrEqual(390);
      await page.keyboard.press("Escape");
    });

    await test.step("svaka administratorska promena ima audit trag", async () => {
      const auditActions = new Set(
        (
          await db.auditLog.findMany({
            where: { actorId: created.adminId },
            select: { action: true },
          })
        ).map((entry) => entry.action),
      );
      for (const action of [
        "action.upsert",
        "action.product.upsert",
        "action.product.delete",
        "action.delete",
        "loyalty.upsert",
        "loyalty.delete",
        "linear-promotion.upsert",
        "linear-promotion.delete",
      ]) {
        expect(auditActions).toContain(action);
      }
      expect(auditActions).toContain("action.upsert.error");
      expect(formActionWarnings).toEqual([]);
    });
  });

  function actionPrice(actionSlug: string) {
    return db.actionProduct
      .findFirst({
        where: {
          action: { slug: actionSlug },
          productId: created.actionProductId,
        },
        select: { salePrice: true },
      })
      .then((row) => (row ? Number(row.salePrice) : null));
  }

  async function cleanup() {
    await db.linearPromotion.deleteMany({
      where: { name: { startsWith: tag } },
    });
    await db.loyaltyRule.deleteMany({
      where: { name: { startsWith: tag } },
    });
    await db.action.deleteMany({
      where: {
        OR: [
          { name: { startsWith: tag } },
          { slug: { startsWith: slugBase } },
        ],
      },
    });
    await db.priceList.deleteMany({
      where: { code: fixture.mpPriceListCode },
    });
    await db.product.deleteMany({
      where: {
        sku: { in: [fixture.actionSku, fixture.loyaltySku] },
      },
    });
    await db.category.deleteMany({
      where: { slug: `${slugBase}-podgrupa` },
    });
    await db.category.deleteMany({
      where: { slug: `${slugBase}-kategorija` },
    });
    await db.group.deleteMany({ where: { slug: `${slugBase}-grupa` } });
    await db.collection.deleteMany({
      where: { slug: `${slugBase}-kolekcija` },
    });
    await db.supplier.deleteMany({ where: { name: fixture.supplier } });
    await db.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { key: { contains: fixture.adminEmail } },
          { key: { contains: fixture.customerEmail } },
        ],
      },
    });
    const admin = await db.adminUser.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true },
    });
    if (admin) await db.auditLog.deleteMany({ where: { actorId: admin.id } });
    await db.adminUser.deleteMany({
      where: { email: fixture.adminEmail },
    });
    await db.user.deleteMany({ where: { email: fixture.customerEmail } });
    if (created.createdWarehouse && created.warehouseId) {
      await db.warehouse.deleteMany({ where: { id: created.warehouseId } });
    }
  }
});

function actionForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.locator('input[name="slug"]') })
    .first();
}

function actionRow(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(escapeRegex(name)) });
}

function loyaltyForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Dodaj u istoriju" }) });
}

function linearForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Dodaj promociju" }) });
}

async function fillActionForm(
  form: Locator,
  values: {
    name: string;
    slug: string;
    kind: string;
    startsAt: string;
    endsAt: string;
    priority: number;
    isHero?: boolean;
  },
) {
  await form.locator('input[name="name"]').fill(values.name);
  await form.locator('input[name="slug"]').fill(values.slug);
  await form.locator('select[name="kind"]').selectOption(values.kind);
  await form.locator('input[name="startsAt"]').fill(values.startsAt);
  await form.locator('input[name="endsAt"]').fill(values.endsAt);
  await form.locator('input[name="priority"]').fill(String(values.priority));
  const hero = form.getByLabel("Glavna akcija");
  if ((await hero.isChecked()) !== Boolean(values.isHero)) await hero.click();
}

async function createAction(
  page: Page,
  values: Parameters<typeof fillActionForm>[1],
) {
  await page.getByRole("button", { name: "Nova akcija" }).click();
  const form = actionForm(page);
  await fillActionForm(form, values);
  await form.getByRole("button", { name: "Dodaj akciju" }).click();
  await expect(actionRow(page, values.name)).toBeVisible({ timeout: 30_000 });
}

async function fillLoyaltyForm(
  form: Locator,
  values: {
    name: string;
    discountPct: number;
    startsAt: string;
    endsAt: string;
    priority: number;
    active: boolean;
  },
) {
  await form.locator('input[name="name"]').fill(values.name);
  await form
    .locator('input[name="discountPct"]')
    .fill(String(values.discountPct));
  await form.locator('input[name="startsAt"]').fill(values.startsAt);
  await form.locator('input[name="endsAt"]').fill(values.endsAt);
  await form.locator('input[name="priority"]').fill(String(values.priority));
  const active = form.getByLabel("Aktivno");
  if ((await active.isChecked()) !== values.active) await active.click();
}

async function createLinearPromotion(
  page: Page,
  values: {
    name: string;
    discountPct: number;
    startsAt: string;
    endsAt: string;
    priority: number;
    categoryLabel?: string;
    groupLabel?: string;
  },
) {
  const form = linearForm(page);
  await form.locator('input[name="name"]').fill(values.name);
  await form
    .locator('input[name="discountPct"]')
    .fill(String(values.discountPct));
  await form.locator('input[name="startsAt"]').fill(values.startsAt);
  await form.locator('input[name="endsAt"]').fill(values.endsAt);
  await form.locator('input[name="priority"]').fill(String(values.priority));
  const active = form.getByLabel("Aktivna");
  if (!(await active.isChecked())) await active.click();
  if (values.categoryLabel) {
    await form.getByLabel(values.categoryLabel, { exact: true }).check();
  }
  if (values.groupLabel) {
    await form.getByLabel(values.groupLabel, { exact: true }).check();
  }
  await form.getByRole("button", { name: "Dodaj promociju" }).click();
  await expect(page.getByText(values.name, { exact: true })).toBeVisible();
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
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clickPromise;
}

function dateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("Database URL is required for Modul 7 acceptance.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Modul 7 acceptance is allowed only on a local database.");
  }
  const adapter = new PrismaPg({ connectionString: url.toString() });
  return new PrismaClient({ adapter });
}

function databaseUrl() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
}

function hasLocalDatabaseUrl() {
  const raw = databaseUrl();
  if (!raw) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(raw).hostname);
  } catch {
    return false;
  }
}
