// Acceptance: CONTENT mobile-search CMS. This suite mutates only an explicitly
// configured QA/test database and is fail-closed in playwright.config.ts.
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("mobile search CMS acceptance", () => {
  test.skip(
    process.env.E2E_MOBILE_SEARCH_CMS !== "1",
    "Set E2E_MOBILE_SEARCH_CMS=1 with an isolated E2E_DATABASE_URL to run this suite.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    email: `qa.mobile-search.${runId}@example.invalid`,
    password: `QaMobileSearch!${runId}x`,
    labels: [`QA Aktuelno A ${runId}`, `QA Aktuelno B ${runId}`],
    queries: ["qa akcija", "qa nameštaj", "qa rasveta", "qa aparati", "qa bašta", "qa bazeni"],
  };
  let db: PrismaClient;
  let adminId: string | null = null;
  let originalConfig: Awaited<ReturnType<typeof readConfig>> = null;
  const createdImageUrls = new Set<string>();

  test.beforeAll(async () => {
    db = createDatabaseClient();
    originalConfig = await readConfig(db);
    await db.mobileSearchConfig.deleteMany({ where: { key: "storefront" } });
    const passwordHash = await bcrypt.hash(fixture.password, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.email,
        passwordHash,
        role: "CONTENT",
        enabled: true,
        firstName: "QA",
        lastName: "Mobilna pretraga",
      },
      select: { id: true },
    });
    adminId = admin.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      const saved = await readConfig(db);
      saved?.currentItems.forEach((item) => {
        if (!originalConfig?.currentItems.some((original) => original.imageUrl === item.imageUrl)) {
          createdImageUrls.add(item.imageUrl);
        }
      });
      await db.mobileSearchConfig.deleteMany({ where: { key: "storefront" } });
      if (originalConfig) await restoreConfig(db, originalConfig);
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({ where: { key: { contains: fixture.email } } });
      await db.adminUser.deleteMany({ where: { email: fixture.email } });
      const keys = [...createdImageUrls].flatMap((url) => {
        const key = productMediaStorageKey(url);
        return key ? [key] : [];
      });
      if (keys.length) {
        const { error } = await createStorageClient().storage
          .from(productMediaBucket())
          .remove(keys);
        if (error) throw error;
      }
    } finally {
      await db.$disconnect();
    }
  });

  test("validira, bira i ređa proizvode, čuva slike, audituje i osvežava storefront", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);
    await page.goto("/admin/mobilna-pretraga", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Mobilna pretraga" })).toBeVisible();
    const form = page.getByTestId("mobile-search-config-form");
    await expect(form.locator('input[name="productSkus"]')).toHaveCount(4);

    const firstProduct = form.locator('[data-testid^="mobile-search-selected-product-"]').first();
    const firstSku = await firstProduct.locator('input[name="productSkus"]').inputValue();
    await firstProduct.getByRole("button", { name: /^Ukloni / }).click();
    await expect(form.locator('input[name="productSkus"]')).toHaveCount(3);
    await form.getByLabel("Pronađite proizvod").fill(firstSku);
    await form.getByRole("button", { name: "Pretraži" }).click();
    await form.getByTestId(`mobile-search-product-result-${firstSku}`).click();
    await expect(form.locator('input[name="productSkus"]')).toHaveCount(4);

    const firstAfterSelection = form
      .locator('[data-testid^="mobile-search-selected-product-"]')
      .first();
    await firstAfterSelection.getByRole("button", { name: /^Pomeri .* dole$/ }).click();
    const expectedSkus = await form
      .locator('input[name="productSkus"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

    await form.locator('input[name="currentLabel1"]').fill(fixture.labels[0]);
    await form.locator('input[name="currentLabel2"]').fill(fixture.labels[1]);
    await form.locator('select[name="currentDestination1"]').selectOption("href:/akcija");
    await form.locator('select[name="currentDestination2"]').selectOption("href:/novo");
    await form.locator('select[name="viewAllDestination"]').selectOption("href:/akcija");
    const imagePath = path.join(process.cwd(), "public/brand/heroji-meseca.png");
    await form.locator('input[name="currentImageFile1"]').setInputFiles(imagePath);
    await form.locator('input[name="currentImageFile2"]').setInputFiles(imagePath);
    for (const [index, query] of fixture.queries.entries()) {
      await form.locator(`input[name="frequentQuery${index + 1}"]`).fill(query);
    }

    await form.locator('input[name="frequentQuery2"]').fill(fixture.queries[0]);
    await form.getByRole("button", { name: "Sačuvaj mobilnu pretragu" }).click();
    await expect(form.getByRole("alert")).toContainText("šest različitih");

    await form.locator('input[name="frequentQuery2"]').fill(fixture.queries[1]);
    await form.locator('input[name="currentImageFile1"]').setInputFiles(imagePath);
    await form.locator('input[name="currentImageFile2"]').setInputFiles(imagePath);
    await form.getByRole("button", { name: "Sačuvaj mobilnu pretragu" }).click();
    await expect(form.getByRole("status")).toContainText("Mobilna pretraga je sačuvana");

    const saved = await db.mobileSearchConfig.findUniqueOrThrow({
      where: { key: "storefront" },
      include: {
        currentItems: { orderBy: { position: "asc" } },
        products: { orderBy: { position: "asc" }, include: { product: { select: { sku: true } } } },
      },
    });
    expect(saved.currentItems.map((item) => item.label)).toEqual(fixture.labels);
    expect(saved.currentItems.every((item) => item.imageUrl.includes("/content/mobile-search/"))).toBe(true);
    expect(saved.products.map((entry) => entry.product.sku)).toEqual(expectedSkus);
    expect(saved.frequentQueries).toEqual(fixture.queries);
    expect(saved.viewAllHref).toBe("/akcija");

    const auditActions = new Set(
      (
        await db.auditLog.findMany({
          where: { actorId: adminId! },
          select: { action: true },
        })
      ).map((entry) => entry.action),
    );
    expect(auditActions).toContain("mobileSearch.save.error");
    expect(auditActions).toContain("mobileSearch.save");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Pretraži" }).click();
    await expect(page.getByText(fixture.labels[0], { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.labels[1], { exact: true })).toBeVisible();
    for (const query of fixture.queries) {
      await expect(page.getByRole("button", { name: new RegExp(`^${escapeRegex(query)}`) })).toBeVisible();
    }
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(fixture.email);
    await page.getByLabel("Lozinka").fill(fixture.password);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 90_000 });
  }
});

function readConfig(db: PrismaClient) {
  return db.mobileSearchConfig.findUnique({
    where: { key: "storefront" },
    include: {
      currentItems: { orderBy: { position: "asc" } },
      products: { orderBy: { position: "asc" } },
    },
  });
}

async function restoreConfig(
  db: PrismaClient,
  config: NonNullable<Awaited<ReturnType<typeof readConfig>>>,
) {
  await db.mobileSearchConfig.create({
    data: {
      key: config.key,
      viewAllHref: config.viewAllHref,
      frequentQueries: config.frequentQueries,
      currentItems: {
        create: config.currentItems.map((item) => ({
          position: item.position,
          label: item.label,
          imageUrl: item.imageUrl,
          enabled: item.enabled,
          actionId: item.actionId,
          landingPageId: item.landingPageId,
          href: item.href,
        })),
      },
      products: {
        create: config.products.map((item) => ({
          position: item.position,
          productId: item.productId,
        })),
      },
    },
  });
}

function createDatabaseClient() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for mobile-search QA.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set("sslmode", process.env.DATABASE_SSLMODE?.trim() || "no-verify");
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}

function createStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase storage access is required.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function productMediaBucket() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET?.trim() ||
    process.env.SUPABASE_STORAGE_BUCKET?.trim() ||
    "product-media"
  );
}

function productMediaStorageKey(url: string) {
  const marker = `/storage/v1/object/public/${productMediaBucket()}/`;
  const index = url.indexOf(marker);
  return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
