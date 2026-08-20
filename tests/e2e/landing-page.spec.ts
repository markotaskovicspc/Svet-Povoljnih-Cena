// Acceptance: CONTENT-08
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";

test.describe("landing page create, publish and reopen acceptance", () => {
  test.skip(
    process.env.E2E_LANDING_PAGES !== "1",
    "Set E2E_LANDING_PAGES=1 to run the landing-page browser acceptance.",
  );
  test.setTimeout(240_000);

  const runId = `${Date.now()}-${process.pid}`;
  const slug = `qa-landing-${runId}`;
  const title = `QA landing ${runId}`;
  const ctaLabel = `Pogledaj proizvode ${runId}`;
  const adminEmail = `qa.landing.${runId}@example.invalid`;
  const adminPassword = `QaLanding!${runId}x`;
  let db: PrismaClient;
  let adminId = "";
  let selectedProduct: { sku: string; name: string };

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
    const product = await db.product.findFirst({
      where: {
        AND: [
          webStorefrontProductWhere(),
          {
            OR: [
              { familyMembership: { is: null } },
              { familyMembership: { is: { storefrontEnabled: true } } },
            ],
          },
        ],
        deletedAt: null,
      },
      select: { sku: true, name: true },
      orderBy: { sku: "asc" },
    });
    if (!product) throw new Error("Landing-page acceptance requires one web-visible product.");
    selectedProduct = product;
  });

  test.afterAll(async () => {
    if (!db) return;
    const page = await db.landingPage.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (page) {
      await db.landingPage.update({
        where: { id: page.id },
        data: { draftRevisionId: null, publishedRevisionId: null },
      });
      await db.landingPage.delete({ where: { id: page.id } });
    }
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
    await db.$disconnect();
  });

  test("CONTENT admin creates a draft, publishes it, reloads the public page and reopens it from the grid", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await login(page);
    await expect(
      page.getByRole("heading", { name: "Nova landing strana", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Naziv stranice (nevidljivi H1)").fill(title);
    await page.getByLabel("Desktop slika").fill("/logo.jpeg");
    await page.getByLabel("Naziv CTA dugmeta").fill(ctaLabel);
    await page.getByLabel("CTA link").fill("#proizvodi");
    await page.getByLabel("Pretraga po nazivu ili SKU-u").fill(selectedProduct.sku);
    await page.getByRole("button", { name: "Pretraži" }).click();
    const searchResult = page.getByRole("button").filter({ hasText: selectedProduct.sku });
    await expect(searchResult).toHaveCount(1);
    await searchResult.click();
    await expect(page.locator('input[name="productSkus"]')).toHaveValue(
      new RegExp(selectedProduct.sku),
    );
    await page.getByRole("button", { name: "Sačuvaj nacrt" }).click();
    await expect(page).toHaveURL(
      /\/admin\/erp\/landing-strane\/(?!nova(?:[?#]|$))[^/?#]+$/,
      { timeout: 90_000 },
    );

    const draft = await db.landingPage.findUniqueOrThrow({
      where: { slug },
      include: { revisions: true },
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.revisions).toHaveLength(1);
    expect(draft.draftRevisionId).toBeTruthy();
    expect(draft.publishedRevisionId).toBeNull();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Objavi verziju" }).click();
    await expect(page.getByText("Landing strana je objavljena.")).toBeVisible();
    await expect
      .poll(async () =>
        (
          await db.landingPage.findUniqueOrThrow({
            where: { slug },
            select: { status: true },
          })
        ).status,
      )
      .toBe("PUBLISHED");

    const published = await db.landingPage.findUniqueOrThrow({
      where: { slug },
      include: { revisions: { orderBy: { version: "asc" } } },
    });
    expect(published.revisions.map(({ version }) => version)).toEqual([1, 2]);
    expect(published.publishedRevisionId).toBe(published.draftRevisionId);

    await page.goto(`/ponuda/${slug}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: title })).toHaveClass(/sr-only/);
    await expect(page.getByRole("link", { name: ctaLabel })).toHaveAttribute("href", "#proizvodi");
    await expect(page.getByRole("heading", { name: "Filteri" })).toBeVisible();
    await expect(page.getByText(selectedProduct.name, { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: title })).toHaveClass(/sr-only/);
    await expect(page.getByText(selectedProduct.name, { exact: true })).toBeVisible();

    await page.goto("/admin/erp/landing-strane", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-client-ready="true"]')).toBeVisible();
    const search = page.getByPlaceholder("Brza pretraga po vidljivim kolonama");
    await search.fill(slug);
    const row = page.getByRole("row").filter({ hasText: slug });
    await expect(row).toHaveCount(1);
    await row.dblclick({ position: { x: 300, y: 20 } });
    await expect(page).toHaveURL(
      new RegExp(`/admin/erp/landing-strane/${published.id}$`),
    );
    await expect(page.getByLabel("Slug")).toHaveValue(slug);
    await expect(page.getByLabel("Slug")).toHaveAttribute("readonly");
    await expect(page.getByLabel("Naziv stranice (nevidljivi H1)")).toHaveValue(title);
    await expect(page.locator('input[name="productSkus"]')).toHaveValue(
      new RegExp(selectedProduct.sku),
    );
    await expect(page.getByText("Verzija 2")).toBeVisible();

    const unexpectedRuntimeErrors = runtimeErrors.filter(
      (message) =>
        !(
          message.includes("ClientFetchError") &&
          message.includes("Failed to fetch")
        ),
    );
    expect(unexpectedRuntimeErrors).toEqual([]);
  });

  async function login(page: Page) {
    await page.goto(
      "/admin/prijava?callbackUrl=%2Fadmin%2Ferp%2Flanding-strane%2Fnova",
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/erp\/landing-strane\/nova$/, {
      timeout: 90_000,
    });
  }
});

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for landing-page acceptance.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
