// Acceptance: PROD-06
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

test.describe("isolated admin-result to storefront publication", () => {
  test.skip(
    process.env.E2E_STOREFRONT_PUBLICATION !== "1",
    "Set E2E_STOREFRONT_PUBLICATION=1 with an isolated E2E_DATABASE_URL.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const rootSlug = `qa-pub-root-${runId}`;
  const childSlug = `qa-pub-child-${runId}`;
  const categoryPath = `/${rootSlug}/${childSlug}`;
  const sku = `QA-PUB-${runId}`.slice(0, 80);
  const name = `QA objavljen artikal ${runId}`;
  let db: PrismaClient;
  let productId = "";
  let priceListId = "";
  let childCategoryId = "";
  let rootCategoryId = "";
  let supplierId = "";

  test.beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Pinned DATABASE_URL is required.");
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
    });
    const root = await db.category.create({
      data: {
        name: `QA publication root ${runId}`,
        slug: rootSlug,
        path: `/${rootSlug}`,
        level: 0,
      },
    });
    rootCategoryId = root.id;
    const child = await db.category.create({
      data: {
        name: `QA publication child ${runId}`,
        slug: childSlug,
        path: categoryPath,
        level: 1,
        parentId: root.id,
      },
    });
    childCategoryId = child.id;
    const supplier = await db.supplier.create({
      data: {
        code: `QA-PUB-${runId}`.slice(0, 40),
        name: `QA publication supplier ${runId}`,
      },
    });
    supplierId = supplier.id;
    const product = await db.product.create({
      data: {
        sku,
        slug: `qa-published-${runId}`,
        name,
        shortName: name,
        description: "Izolovani publication acceptance artikal.",
        shortDescription: "Publication acceptance",
        supplierId: supplier.id,
        articleStatus: "SP",
        isActive: true,
        availableWebManual: true,
        availableWebAuto: true,
        fullPrice: 1_000,
        stock: 5,
        dcAvailableQty: 5,
        widthCm: 10,
        depthCm: 20,
        heightCm: 30,
        categories: { create: { categoryId: child.id } },
        media: {
          create: {
            kind: "IMAGE",
            url: "/logo.jpeg",
            syncStatus: "READY",
            order: 0,
          },
        },
      },
    });
    productId = product.id;
    const priceList = await db.priceList.create({
      data: {
        code: `QA-PUB-${runId}`.slice(0, 80),
        name: `QA publication MP ${runId}`,
        kind: "RETAIL",
        currency: "RSD",
        active: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        entries: {
          create: {
            productId: product.id,
            price: 1_000,
            validFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      },
    });
    priceListId = priceList.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (productId) await db.product.deleteMany({ where: { id: productId } });
    if (priceListId) await db.priceList.deleteMany({ where: { id: priceListId } });
    if (childCategoryId) {
      await db.category.deleteMany({ where: { id: childCategoryId } });
    }
    if (rootCategoryId) {
      await db.category.deleteMany({ where: { id: rootCategoryId } });
    }
    if (supplierId) await db.supplier.deleteMany({ where: { id: supplierId } });
    await db.$disconnect();
  });

  test("the exact catalog API result renders as one visible category card", async ({
    page,
  }) => {
    const apiResponse = await page.request.get(
      `/api/products?categoryPath=${encodeURIComponent(categoryPath)}&limit=24`,
    );
    const apiPayload = (await apiResponse.json()) as {
      ok: boolean;
      items: Array<{ sku: string; name: string }>;
    };
    expect(apiResponse.ok(), JSON.stringify(apiPayload)).toBe(true);
    expect(apiPayload.items).toContainEqual(
      expect.objectContaining({ sku, name }),
    );

    await page.goto(`/k/${rootSlug}/${childSlug}`, {
      waitUntil: "domcontentloaded",
    });
    const card = page.locator("article").filter({
      has: page.getByRole("heading", { level: 3, name, exact: true }),
    });
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name, exact: true })).toBeVisible();
  });
});
