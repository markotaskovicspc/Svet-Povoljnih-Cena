import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

test.describe("Rabalux checkout and admin acceptance", () => {
  test.skip(
    process.env.E2E_RABALUX !== "1",
    "Set E2E_RABALUX=1 to run the isolated write-and-cleanup scenario.",
  );
  test.setTimeout(120_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.rabalux.${runId}@example.invalid`,
    adminPassword: `QaRabalux!${runId}`,
    sku: `RAB-E2E-${runId}`.slice(0, 64),
    sourceSku: `E2E-${runId}`.slice(0, 64),
    checkoutSessionId: `rabalux-e2e-${runId}`,
  };
  let db: PrismaClient;
  let productId = "";
  let orderId = "";
  let categoryId = "";
  let groupId = "";

  test.beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
      log: ["error"],
    });
    const supplier = await db.supplier.findUniqueOrThrow({
      where: { integrationKey: "RABALUX" },
    });
    await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash: await bcrypt.hash(fixture.adminPassword, 12),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Rabalux",
      },
    });
    const category = await db.category.create({
      data: {
        name: `QA Rabalux ${runId}`,
        slug: `qa-rabalux-${runId}`,
        path: `/qa-rabalux-${runId}`,
        level: 0,
      },
    });
    categoryId = category.id;
    const group = await db.group.create({
      data: {
        name: `QA Rabalux ${runId}`,
        slug: `qa-rabalux-${runId}`,
      },
    });
    groupId = group.id;
    const product = await db.product.create({
      data: {
        sku: fixture.sku,
        slug: fixture.sku.toLowerCase(),
        name: "QA Rabalux checkout proizvod",
        description: "Označen lokalni E2E fixture.",
        groupId,
        fullPrice: 1_500,
        widthCm: 10,
        depthCm: 10,
        heightCm: 10,
        packWidthCm: 12,
        packDepthCm: 12,
        packHeightCm: 12,
        stock: 0,
        supplierStock: 3,
        supplierId: supplier.id,
        supplierExternalId: fixture.sourceSku,
        isActive: true,
        categories: { create: { categoryId } },
        media: {
          create: {
            kind: "IMAGE",
            url: `rabalux/${fixture.sourceSku}/ready.jpg`,
            syncStatus: "READY",
          },
        },
      },
    });
    productId = product.id;
  });

  test.afterAll(async () => {
    try {
      await db.checkoutSession.deleteMany({
        where: { id: fixture.checkoutSessionId },
      });
      if (orderId) {
        await db.backgroundJob.deleteMany({
          where: {
            OR: [
              { payload: { path: ["orderId"], equals: orderId } },
              { idempotencyKey: { contains: orderId } },
            ],
          },
        });
        const fulfillmentIds = (
          await db.supplierFulfillment.findMany({
            where: { orderId },
            select: { id: true },
          })
        ).map(({ id }) => id);
        if (fulfillmentIds.length) {
          await db.backgroundJob.deleteMany({
            where: {
              OR: fulfillmentIds.map((id) => ({
                idempotencyKey: { contains: id },
              })),
            },
          });
          await db.emailMessage.deleteMany({
            where: {
              OR: fulfillmentIds.map((id) => ({
                idempotencyKey: { contains: id },
              })),
            },
          });
        }
        await db.order.deleteMany({ where: { id: orderId } });
      }
      if (productId) {
        await db.stockMovement.deleteMany({ where: { productId } });
        await db.product.deleteMany({ where: { id: productId } });
      }
      if (categoryId) await db.category.deleteMany({ where: { id: categoryId } });
      if (groupId) await db.group.deleteMany({ where: { id: groupId } });
      await db.auditLog.deleteMany({
        where: { actor: { email: fixture.adminEmail } },
      });
      await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
    } finally {
      await db?.$disconnect();
    }
  });

  test("supplier checkout appears in admin and pickup confirmation persists", async ({
    page,
    request,
  }) => {
    const checkout = await request.post("/api/checkout/order", {
      data: {
        checkoutSessionId: fixture.checkoutSessionId,
        guestEmail: "qa.rabalux.order@example.invalid",
        lines: [{ sku: fixture.sku, qty: 1 }],
        shipping: {
          firstName: "QA",
          lastName: "Kupac",
          phone: "0601234567",
          street: "Test ulica 1",
          city: "Beograd",
          postalCode: "11000",
          country: "RS",
        },
        billingSameAsShipping: true,
        shippingMethod: "KAMION",
        paymentMethod: "POUZECE_GOTOVINA",
        consent: true,
      },
    });
    expect(checkout.status()).toBe(201);
    const payload = await checkout.json();
    expect(payload.ok).toBe(true);
    orderId = payload.data.id;

    await page.goto(
      `/admin/prijava?callbackUrl=${encodeURIComponent(
        `/admin/narudzbine/${orderId}`,
      )}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/narudzbine/${orderId}$`), {
      timeout: 30_000,
    });
    const pickupForms = page.locator("form").filter({
      has: page.getByRole("button", { name: "Potvrdi preuzimanje" }),
    });
    await expect(pickupForms).toHaveCount(1);
    await expect(
      page.getByText(fixture.sourceSku, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Status: SENT")).toBeVisible();

    const pickupForm = pickupForms.first();
    await pickupForm.getByLabel("Potvrđena lokacija").selectOption({ index: 1 });
    await pickupForm.getByLabel("Adresa", { exact: true }).fill("QA adresa 1");
    await pickupForm.getByLabel("Grad", { exact: true }).fill("Beograd");
    await pickupForm.getByLabel("Razlog potvrde").fill("Lokalna QA potvrda");
    page.once("dialog", (dialog) => dialog.accept());
    await pickupForm.getByRole("button", { name: "Potvrdi preuzimanje" }).click();
    await expect(pickupForm.getByRole("status")).toContainText(
      "Mesto preuzimanja je potvrđeno",
    );
    await expect
      .poll(async () => {
        const fulfillment = await db.supplierFulfillment.findUnique({
          where: {
            orderId_supplierId: {
              orderId,
              supplierId: (
                await db.supplier.findUniqueOrThrow({
                  where: { integrationKey: "RABALUX" },
                  select: { id: true },
                })
              ).id,
            },
          },
          select: {
            status: true,
            loadingLocation: { select: { address: true, city: true } },
          },
        });
        return fulfillment;
      })
      .toEqual({
        status: "CONFIRMED",
        loadingLocation: { address: "QA adresa 1", city: "Beograd" },
      });
    const fulfillment = await db.supplierFulfillment.findFirstOrThrow({
      where: { orderId },
      select: { id: true },
    });
    await expect
      .poll(async () => {
        const audit = await db.auditLog.findFirst({
          where: {
            action: "supplierFulfillment.confirm.mutation",
            entityId: fulfillment.id,
          },
          orderBy: { createdAt: "desc" },
          select: { actorId: true, diff: true },
        });
        return audit;
      })
      .toMatchObject({
        actorId: expect.any(String),
        diff: {
          reason: "Lokalna QA potvrda",
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          previousStatus: "SENT",
          status: "CONFIRMED",
        },
      });
    await page.waitForLoadState("networkidle");
  });
});
