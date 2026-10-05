// Acceptance: CONTENT-08
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { databaseLandingPageKey } from "@/lib/storefront/homepage-landing";
import { requireSafeE2EDatabase } from "../helpers/e2e-database-safety";

test.describe("landing page create, publish and reopen acceptance", () => {
  test.skip(
    process.env.E2E_LANDING_PAGES !== "1",
    "Set E2E_LANDING_PAGES=1 to run the landing-page browser acceptance.",
  );
  test.setTimeout(360_000);

  const runId = `${Date.now()}-${process.pid}`;
  const slug = `qa-landing-${runId}`;
  const title = `QA landing ${runId}`;
  const ctaLabel = `Pogledaj proizvode ${runId}`;
  const adminEmail = `qa.landing.${runId}@example.invalid`;
  const adminPassword = `QaLanding!${runId}x`;
  const products = Array.from({ length: 5 }, (_, index) => ({
    sku: `QA-LANDING-${runId}-${index + 1}`,
    slug: `qa-landing-product-${runId}-${index + 1}`,
    name: `QA kofer ${index + 1} ${runId}`,
  }));
  // Two pairs of colours and a third standalone model reproduce five selected
  // ERP articles being collapsed into only three storefront family cards.
  const familyMemberIndexes = [[0, 1], [2, 4], [3]];
  let db: PrismaClient;
  let adminId = "";
  let priceListId = "";
  let rootCategoryId = "";
  let childCategoryId = "";
  let groupId = "";
  let homeSlotId = "";
  const familyIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "CONTENT",
        enabled: true,
        firstName: "QA",
        lastName: "Landing",
      },
      select: { id: true },
    });
    adminId = admin.id;
    const root = await db.category.create({
      data: { name: `QA landing ${runId}`, slug: `qa-landing-root-${runId}`, path: `/qa-landing-root-${runId}` },
    });
    rootCategoryId = root.id;
    const child = await db.category.create({
      data: {
        name: "QA koferi",
        slug: `qa-landing-child-${runId}`,
        path: `${root.path}/qa-landing-child-${runId}`,
        parentId: root.id,
        level: 1,
      },
    });
    childCategoryId = child.id;
    const group = await db.group.create({
      data: { name: `QA koferi ${runId}`, slug: `qa-landing-group-${runId}` },
    });
    groupId = group.id;
    const priceList = await db.priceList.create({
      data: { code: `QA-LANDING-${runId}`, name: "QA landing MP", kind: "RETAIL", active: true },
    });
    priceListId = priceList.id;
    const productIds: string[] = [];
    for (const product of products) {
      const created = await db.product.create({
        data: {
          ...product,
          description: "Privremeni izolovani proizvod za landing acceptance.",
          groupId,
          fullPrice: 1_000,
          isActive: true,
          articleStatus: "SP",
          availableWebManual: true,
          availableWebAuto: true,
          stock: 10,
          dcAvailableQty: 10,
          categories: { create: { categoryId: childCategoryId } },
          media: { create: { kind: "IMAGE", url: "/logo.jpeg", syncStatus: "READY", order: 0 } },
          priceListEntries: {
            create: { priceListId, price: 1_000, validFrom: new Date("2020-01-01T00:00:00Z") },
          },
        },
        select: { id: true },
      });
      productIds.push(created.id);
    }
    for (const [index, members] of familyMemberIndexes.entries()) {
      const family = await db.productFamily.create({
        data: {
          code: `QA-LANDING-${runId}-${index}`,
          primaryProductId: productIds[members[0]],
          members: {
            create: members.map((productIndex, position) => ({
              productId: productIds[productIndex],
              label: position ? "Crna" : "Srebrna",
              labelKey: position ? "crna" : "srebrna",
              position,
              storefrontEnabled: true,
            })),
          },
        },
        select: { id: true },
      });
      familyIds.push(family.id);
    }
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      if (homeSlotId) await db.homeSectionSlot.deleteMany({ where: { id: homeSlotId } });
      const landing = await db.landingPage.findUnique({ where: { slug }, select: { id: true } });
      if (landing) {
        await db.landingPage.update({
          where: { id: landing.id },
          data: { draftRevisionId: null, publishedRevisionId: null },
        });
        await db.landingPage.delete({ where: { id: landing.id } });
      }
      await db.productFamily.deleteMany({ where: { id: { in: familyIds } } });
      await db.product.deleteMany({ where: { sku: { in: products.map((product) => product.sku) } } });
      if (priceListId) await db.priceList.deleteMany({ where: { id: priceListId } });
      if (groupId) await db.group.deleteMany({ where: { id: groupId } });
      if (childCategoryId) await db.category.deleteMany({ where: { id: childCategoryId } });
      if (rootCategoryId) await db.category.deleteMany({ where: { id: rootCategoryId } });
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({ where: { key: { contains: adminEmail } } });
      await db.adminUser.deleteMany({ where: { email: adminEmail } });
    } finally {
      await db.$disconnect();
    }
  });

  test("publishes all five selected family articles without a banner, then adds and removes a banner", async ({
    context,
    page,
    baseURL,
  }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await context.addCookies([{ name: "spc_cookie_consent", value: "essential", url: baseURL! }]);

    await login(page);
    await expect(page.getByRole("heading", { name: "Nova landing strana", exact: true })).toBeVisible();
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Naziv stranice (H1)").fill(title);
    // Leave both banner images and the CTA empty, including the default anchor.
    await page.getByLabel("CTA link").fill("");
    await page.getByLabel("Pretraga po nazivu ili SKU-u").fill(`QA-LANDING-${runId}`);
    await page.getByRole("button", { name: "Pretraži" }).click();
    for (const product of products) {
      const result = page.getByRole("button").filter({ hasText: product.sku });
      await expect(result).toHaveCount(1);
      await result.click();
    }
    await expect(page.locator('input[name="productSkus"]')).toHaveValue(JSON.stringify(products.map((product) => product.sku)));
    await page.getByRole("button", { name: "Sačuvaj nacrt" }).click();
    await expect(page).toHaveURL(/\/admin\/erp\/landing-strane\/(?!nova(?:[?#]|$))[^/?#]+$/, { timeout: 90_000 });

    const draft = await db.landingPage.findUniqueOrThrow({ where: { slug }, include: { revisions: true } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.revisions).toHaveLength(1);
    expect(draft.publishedRevisionId).toBeNull();
    const editorUrl = `/admin/erp/landing-strane/${draft.id}`;
    // Publishing invalidates the homepage cache, so its CMS rail resolves the
    // same manual list instead of silently collapsing colour siblings.
    const homeSlot = await db.homeSectionSlot.create({
      data: {
        slotKey: "FIRST",
        sourceType: "LANDING_PAGE",
        landingPageKey: databaseLandingPageKey(draft.id),
        titleOverride: title,
        productLimit: 12,
        enabled: true,
      },
      select: { id: true },
    });
    homeSlotId = homeSlot.id;
    await publish(page, 2);

    await page.goto(`/ponuda/${slug}`, { waitUntil: "domcontentloaded" });
    await expectBannerlessProducts(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectBannerlessProducts(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const homeSection = page.locator("section").filter({
      has: page.getByRole("heading", { level: 2, name: title, exact: true }),
    });
    await expect(homeSection).toHaveCount(1);
    await expect(homeSection.locator("article")).toHaveCount(5);
    await expect.poll(() => homeSection.locator("article h3 a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(
      products.map((product) => `/p/${product.slug}`),
    );
    await homeSection.scrollIntoViewIfNeeded();
    await testInfo.attach("homepage-five-selected-articles", { body: await homeSection.screenshot(), contentType: "image/png" });

    await page.goto("/admin/erp/landing-strane", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-client-ready="true"]')).toBeVisible();
    await page.getByPlaceholder("Brza pretraga po vidljivim kolonama").fill(slug);
    const row = page.getByRole("row").filter({ hasText: slug });
    await expect(row).toHaveCount(1);
    await row.dblclick({ position: { x: 300, y: 20 } });
    await expect(page).toHaveURL(new RegExp(`${editorUrl}$`));
    await expect(page.getByLabel("Slug")).toHaveAttribute("readonly");
    await expect(page.getByLabel("Desktop slika")).toHaveValue("");
    await expect(page.locator('input[name="productSkus"]')).toHaveValue(JSON.stringify(products.map((product) => product.sku)));

    // Existing pages can still use a banner and CTA after making it optional.
    await page.getByLabel("Desktop slika").fill("/logo.jpeg");
    await page.getByLabel("Naziv CTA dugmeta").fill(ctaLabel);
    await page.getByLabel("CTA link").fill("#proizvodi");
    await publish(page, 3);
    await page.goto(`/ponuda/${slug}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Glavni baner" })).toBeVisible();
    await expect(page.getByRole("link", { name: ctaLabel, exact: true })).toHaveAttribute("href", "#proizvodi");
    await expectSelectedProducts(page);

    // Removing only the image must hide the whole hero, even with saved CTA data.
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Desktop slika").fill("");
    await publish(page, 4);
    await page.goto(`/ponuda/${slug}`, { waitUntil: "domcontentloaded" });
    await expectBannerlessProducts(page);
    await testInfo.attach("bannerless-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectBannerlessProducts(page);
    await testInfo.attach("bannerless-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    expect(runtimeErrors.filter((message) => !(message.includes("ClientFetchError") && message.includes("Failed to fetch")))).toEqual([]);
  });

  async function expectSelectedProducts(page: Page) {
    const cards = page.locator("#proizvodi article");
    await expect(cards).toHaveCount(5);
    // The exact concrete products and editor order must survive family grouping.
    await expect.poll(() => cards.locator("h3 a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(
      products.map((product) => `/p/${product.slug}`),
    );
  }

  async function expectBannerlessProducts(page: Page) {
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: title })).not.toHaveClass(/sr-only/);
    await expect(page.getByRole("region", { name: "Glavni baner" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: ctaLabel, exact: true })).toHaveCount(0);
    await expectSelectedProducts(page);
  }

  async function publish(page: Page, expectedVersion: number) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Objavi verziju" }).click();
    await expect(page.getByText("Landing strana je objavljena.")).toBeVisible();
    await expect.poll(async () => {
      const landing = await db.landingPage.findUniqueOrThrow({
        where: { slug },
        select: { status: true, draftRevisionId: true, publishedRevisionId: true, publishedRevision: { select: { version: true } } },
      });
      return { status: landing.status, sameRevision: landing.draftRevisionId === landing.publishedRevisionId, version: landing.publishedRevision?.version };
    }).toEqual({ status: "PUBLISHED", sameRevision: true, version: expectedVersion });
  }

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin%2Ferp%2Flanding-strane%2Fnova", { waitUntil: "domcontentloaded" });
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/erp\/landing-strane\/nova$/, { timeout: 90_000 });
  }
});

function createDatabaseClient() {
  const connectionString = requireSafeE2EDatabase();
  if (!connectionString) throw new Error("An isolated E2E_DATABASE_URL is required for landing-page acceptance.");
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 15_000 }, { schema }),
  });
}
