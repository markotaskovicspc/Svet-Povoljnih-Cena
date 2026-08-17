import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("legacy product family admin workflow", () => {
  test.skip(
    process.env.E2E_PRODUCT_FAMILY_LEGACY !== "1",
    "Set E2E_PRODUCT_FAMILY_LEGACY=1 to run the isolated legacy family suite.",
  );

  test.setTimeout(420_000);
  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-FAMILY-${runId}`;
  const familyCode = `QA-FAMILY-${runId}`.slice(0, 64);
  const adminEmail = `qa.family.${runId}@example.invalid`;
  const adminPassword = `QaFamily!${runId}x`;
  const sourceSku = `QA-FAM-A-${runId}`.slice(0, 80);
  const targetSku = `QA-FAM-B-${runId}`.slice(0, 80);
  const draftSku = `QA-FAM-C-${runId}`.slice(0, 80);

  let db: PrismaClient;
  let adminId = "";
  let sourceId = "";
  let targetId = "";
  let rootCategoryId = "";
  let groupCategoryId = "";
  let createdWarehouseId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();

    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Product family",
      },
      select: { id: true },
    });
    adminId = admin.id;

    let warehouse = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!warehouse) {
      warehouse = await db.warehouse.create({
        data: {
          code: `QA-FAMILY-DC-${runId}`.slice(0, 40),
          name: `${tag} DC`,
          active: true,
          isDefault: true,
        },
        select: { id: true },
      });
      createdWarehouseId = warehouse.id;
    }

    const rootCategory = await db.category.create({
      data: {
        name: `${tag} kategorija`,
        slug: `qa-family-root-${runId}`,
        path: `/qa-family-root-${runId}`,
        level: 0,
      },
      select: { id: true },
    });
    rootCategoryId = rootCategory.id;
    const groupCategory = await db.category.create({
      data: {
        name: `${tag} grupa`,
        slug: `qa-family-group-${runId}`,
        path: `/qa-family-root-${runId}/qa-family-group-${runId}`,
        level: 1,
        parentId: rootCategory.id,
      },
      select: { id: true },
    });
    groupCategoryId = groupCategory.id;

    const [source, target] = await Promise.all([
      db.product.create({
        data: productFixture({
          sku: sourceSku,
          slug: `qa-family-source-${runId}`,
          name: `${tag} model`,
          colorPrimary: "Bela",
          warehouseId: warehouse.id,
          categoryId: groupCategory.id,
        }),
        select: { id: true },
      }),
      db.product.create({
        data: productFixture({
          sku: targetSku,
          slug: `qa-family-target-${runId}`,
          name: `${tag} model`,
          colorPrimary: "Crna",
          warehouseId: warehouse.id,
          categoryId: groupCategory.id,
        }),
        select: { id: true },
      }),
    ]);
    sourceId = source.id;
    targetId = target.id;
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("ručno pravi, uređuje i odvaja porodicu, pa dodaje draft boju", async ({
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
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page, sourceId, adminEmail, adminPassword);

    await expect(page.getByRole("heading", { name: "Boje u porodici" })).toBeVisible();
    await expect(
      page.getByText("Unesite eksplicitnu šifru porodice u kartonu ispod."),
    ).toBeVisible();
    await expect(page.getByLabel("Šifra porodice")).toBeVisible();
    await expect(page.getByLabel("Boja 1")).toHaveValue("Bela");
    await expect(page.getByPlaceholder("SKU ili naziv artikla")).toHaveCount(0);

    await saveFamilyMembership(page, {
      familyCode,
      label: "Bela",
      colorHex: "#F8F7F2",
      position: "10",
      primary: true,
      storefrontEnabled: true,
      colorPrimary: "Bela",
      colorSecondary: "",
    });

    await expect
      .poll(async () => {
        const membership = await db.productFamilyMember.findUnique({
          where: { productId: sourceId },
          select: {
            label: true,
            colorHex: true,
            position: true,
            storefrontEnabled: true,
            family: { select: { code: true, primaryProductId: true } },
          },
        });
        return membership;
      })
      .toEqual({
        label: "Bela",
        colorHex: "#F8F7F2",
        position: 10,
        storefrontEnabled: true,
        family: { code: familyCode, primaryProductId: sourceId },
      });

    await page.goto(`/admin/erp/artikli/${targetId}`, {
      waitUntil: "domcontentloaded",
    });
    await saveFamilyMembership(page, {
      familyCode,
      label: "Crna",
      colorHex: "#181716",
      position: "20",
      primary: false,
      storefrontEnabled: false,
      colorPrimary: "Crna",
      colorSecondary: "",
    });

    await expect
      .poll(async () => {
        const family = await db.productFamily.findUnique({
          where: { code: familyCode },
          select: {
            primaryProductId: true,
            members: {
              orderBy: [{ position: "asc" }, { productId: "asc" }],
              select: {
                productId: true,
                label: true,
                position: true,
                storefrontEnabled: true,
              },
            },
          },
        });
        return family;
      })
      .toEqual({
        primaryProductId: sourceId,
        members: [
          {
            productId: sourceId,
            label: "Bela",
            position: 10,
            storefrontEnabled: true,
          },
          {
            productId: targetId,
            label: "Crna",
            position: 20,
            storefrontEnabled: false,
          },
        ],
      });

    await expect(page.getByText(`${sourceSku} ·`, { exact: false })).toBeVisible();
    await expect(page.getByText(`${targetSku} ·`, { exact: false })).toBeVisible();

    await saveFamilyMembership(page, {
      familyCode,
      label: "Crna",
      colorHex: "#181716",
      position: "5",
      primary: true,
      storefrontEnabled: true,
      colorPrimary: "Crna",
      colorSecondary: "",
    });
    await expect
      .poll(async () => {
        const family = await db.productFamily.findUniqueOrThrow({
          where: { code: familyCode },
          select: { primaryProductId: true },
        });
        const membership = await db.productFamilyMember.findUniqueOrThrow({
          where: { productId: targetId },
          select: { position: true, storefrontEnabled: true },
        });
        return { ...family, ...membership };
      })
      .toEqual({
        primaryProductId: targetId,
        position: 5,
        storefrontEnabled: true,
      });

    const draftForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="sourceProductId"]') })
      .filter({ has: page.locator('input[name="label"]') })
      .first();
    const skuInput = draftForm.locator('input[name="sku"]');
    const labelInput = draftForm.locator('input[name="label"]');
    const hexInput = draftForm.locator('input[name="colorHex"]');

    await skuInput.fill(sourceSku);
    await labelInput.fill("Plava");
    await hexInput.fill("#3B82F6");
    await draftForm.getByRole("button", { name: "Nova boja" }).click();
    await expect(draftForm.getByRole("alert")).toContainText(
      `Šifra artikla ${sourceSku} već postoji.`,
      { timeout: 120_000 },
    );

    await skuInput.fill(draftSku);
    await labelInput.fill("Crna");
    await hexInput.fill("#181716");
    await draftForm.getByRole("button", { name: "Nova boja" }).click();
    await expect(draftForm.getByRole("alert")).toContainText(
      `Boja Crna je već povezana sa SKU-om ${targetSku}.`,
      { timeout: 120_000 },
    );

    await skuInput.fill(draftSku);
    await labelInput.fill("Siva");
    await hexInput.fill("#fff");
    expect(await hexInput.evaluate((element) => element.checkValidity())).toBe(false);
    await hexInput.fill("#9CA3AF");
    await draftForm.getByRole("button", { name: "Nova boja" }).click();
    await expect(draftForm.getByRole("status")).toContainText(
      `Nova boja ${draftSku} je kreirana`,
      { timeout: 120_000 },
    );

    await expect
      .poll(async () =>
        db.product.findUnique({
          where: { sku: draftSku },
          select: {
            id: true,
            colorPrimary: true,
            articleStatus: true,
            isActive: true,
            availableWebManual: true,
            familyMembership: {
              select: {
                label: true,
                colorHex: true,
                storefrontEnabled: true,
                family: { select: { code: true } },
              },
            },
          },
        }),
      )
      .not.toBeNull();
    const storedDraft = await db.product.findUniqueOrThrow({
      where: { sku: draftSku },
      select: {
        colorPrimary: true,
        articleStatus: true,
        isActive: true,
        availableWebManual: true,
        familyMembership: {
          select: {
            label: true,
            colorHex: true,
            storefrontEnabled: true,
            family: { select: { code: true } },
          },
        },
      },
    });
    expect(storedDraft).toEqual({
      colorPrimary: "Siva",
      articleStatus: "UZ",
      isActive: false,
      availableWebManual: false,
      familyMembership: {
        label: "Siva",
        colorHex: "#9CA3AF",
        storefrontEnabled: false,
        family: { code: familyCode },
      },
    });

    await page.goto(`/admin/erp/artikli/${sourceId}`, {
      waitUntil: "domcontentloaded",
    });
    const sourceForm = productForm(page);
    await sourceForm.locator('input[name="familyCode"]').fill("");
    await sourceForm.getByRole("checkbox", { name: "Glavna boja" }).uncheck();
    await sourceForm
      .getByRole("checkbox", { name: "Boja spremna za web" })
      .uncheck();
    await sourceForm.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(sourceForm.getByRole("status")).toContainText(
      "Proizvod je sačuvan.",
      { timeout: 120_000 },
    );
    await expect
      .poll(async () =>
        db.product.findUnique({
          where: { id: sourceId },
          select: { id: true, familyMembership: { select: { id: true } } },
        }),
      )
      .toEqual({ id: sourceId, familyMembership: null });

    const remainingFamily = await db.productFamily.findUniqueOrThrow({
      where: { code: familyCode },
      select: {
        primaryProductId: true,
        members: { select: { productId: true } },
      },
    });
    expect(remainingFamily.primaryProductId).toBe(targetId);
    expect(remainingFamily.members).toHaveLength(2);
    expect(runtimeErrors).toEqual([]);
  });

  async function cleanup() {
    if (!db) return;
    const admin = await db.adminUser.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    const products = await db.product.findMany({
      where: {
        OR: [
          { sku: { contains: runId } },
          { name: { startsWith: tag } },
        ],
      },
      select: { id: true },
    });
    if (products.length) {
      await db.product.deleteMany({
        where: { id: { in: products.map(({ id }) => id) } },
      });
    }
    await db.productFamily.deleteMany({
      where: { code: familyCode },
    });
    if (groupCategoryId) {
      await db.category.deleteMany({ where: { id: groupCategoryId } });
    } else {
      await db.category.deleteMany({
        where: { slug: `qa-family-group-${runId}` },
      });
    }
    if (rootCategoryId) {
      await db.category.deleteMany({ where: { id: rootCategoryId } });
    } else {
      await db.category.deleteMany({
        where: { slug: `qa-family-root-${runId}` },
      });
    }
    if (createdWarehouseId) {
      await db.warehouse.deleteMany({ where: { id: createdWarehouseId } });
    } else {
      await db.warehouse.deleteMany({
        where: { code: `QA-FAMILY-DC-${runId}`.slice(0, 40) },
      });
    }
    if (admin?.id || adminId) {
      await db.auditLog.deleteMany({
        where: { actorId: admin?.id ?? adminId },
      });
    }
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
  }
});

function productFixture(input: {
  sku: string;
  slug: string;
  name: string;
  colorPrimary: string;
  warehouseId: string;
  categoryId: string;
}) {
  return {
    sku: input.sku,
    slug: input.slug,
    name: input.name,
    shortName: "Porodični model",
    description: "Privremeni QA proizvod za proveru porodice boja.",
    shortDescription: "QA porodica boja",
    fullPrice: 1_000,
    stock: 5,
    colorPrimary: input.colorPrimary,
    widthCm: 10,
    depthCm: 20,
    heightCm: 30,
    unitPackWidthCm: 10,
    unitPackDepthCm: 20,
    unitPackHeightCm: 30,
    deliveryDaysMin: 2,
    deliveryDaysMax: 4,
    articleStatus: "UZ" as const,
    isActive: false,
    availableWebManual: true,
    categories: { create: { categoryId: input.categoryId } },
    warehouseStocks: {
      create: { warehouseId: input.warehouseId, qty: 5 },
    },
  };
}

function productForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.locator('input[name="familyCode"]') })
    .first();
}

async function saveFamilyMembership(
  page: Page,
  input: {
    familyCode: string;
    label: string;
    colorHex: string;
    position: string;
    primary: boolean;
    storefrontEnabled: boolean;
    colorPrimary: string;
    colorSecondary: string;
  },
) {
  const form = productForm(page);
  const category = form.locator('select[name="siteCategoryId"]');
  const group = form.locator('select[name="siteGroupId"]');
  if (!(await category.inputValue())) {
    await category.selectOption({ index: 1 });
  }
  if (!(await group.inputValue())) {
    await group.selectOption({ index: 1 });
  }
  await form.locator('input[name="familyCode"]').fill(input.familyCode);
  await form.locator('input[name="familyColorLabel"]').fill(input.label);
  await form.locator('input[name="familyColorHex"]').fill(input.colorHex);
  await form.locator('input[name="familyPosition"]').fill(input.position);
  await form
    .getByRole("checkbox", { name: "Glavna boja" })
    .setChecked(input.primary);
  await form
    .getByRole("checkbox", { name: "Boja spremna za web" })
    .setChecked(input.storefrontEnabled);
  await form.locator('input[name="colorPrimary"]').fill(input.colorPrimary);
  await form.locator('input[name="colorSecondary"]').fill(input.colorSecondary);
  await form.getByRole("button", { name: "Sačuvaj izmene" }).click();
  await expect(form.getByRole("status")).toContainText("Proizvod je sačuvan.", {
    timeout: 120_000,
  });
}

async function login(
  page: Page,
  productId: string,
  adminEmail: string,
  adminPassword: string,
) {
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

function createDatabaseClient() {
  const raw = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for family acceptance.");
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
