import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PaymentMethod,
  PrismaClient,
  type PaymentMethodConfig,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("isolated admin mutation acceptance", () => {
  test.skip(
    process.env.E2E_ADMIN_MUTATIONS !== "1",
    "Set E2E_ADMIN_MUTATIONS=1 to run the tagged write-and-cleanup acceptance suite.",
  );

  test.setTimeout(240_000);
  const acceptanceExpect = expect.configure({ timeout: 30_000 });

  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-ADMIN-${runId}`;
  const fixture = {
    adminEmail: `qa.admin.${runId}@example.invalid`,
    adminPassword: `QaAdmin!${runId}x`,
    categoryName: `${tag} kategorija`,
    categorySlug: `qa-admin-${runId}`,
    contentSlug: `qa-admin-uputstvo-${runId}`,
    contentTitle: `${tag} sadržaj`,
    productSku: `QA-${runId}`.slice(0, 80),
    productSlug: `qa-admin-proizvod-${runId}`,
    productName: `${tag} proizvod`,
    productUpdatedName: `${tag} proizvod izmenjen`,
    productMediaAlt: `${tag} fotografija`,
    voucherCode: `QA${runId.replaceAll("-", "")}`.slice(0, 40),
    orderNumber: `QA-${runId}`.slice(0, 80),
    orderEmail: `qa.order.${runId}@example.invalid`,
  };

  let db: PrismaClient;
  let supabase: SupabaseClient;
  let adminId: string | null = null;
  let productId: string | null = null;
  let categoryId: string | null = null;
  let orderId: string | null = null;
  let deliveryRuleId: string | null = null;
  let originalPaymentConfig: Pick<
    PaymentMethodConfig,
    "enabled" | "label" | "note"
  > | null | undefined;
  const uploadedStorageKeys = new Set<string>();

  test.beforeAll(async () => {
    db = createDatabaseClient();
    supabase = createStorageClient();
    await cleanup();

    originalPaymentConfig = await db.paymentMethodConfig.findUnique({
      where: { method: PaymentMethod.UPLATA_NA_RACUN },
      select: { enabled: true, label: true, note: true },
    });

    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash,
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Admin mutations",
      },
      select: { id: true },
    });
    adminId = admin.id;

    const warehouse = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      select: { id: true },
    });
    if (!warehouse) throw new Error("Acceptance test requires a default warehouse.");

    const product = await db.product.create({
      data: {
        sku: fixture.productSku,
        slug: fixture.productSlug,
        name: fixture.productName,
        description: "Privremeni izolovani admin acceptance proizvod.",
        shortDescription: "QA fixture",
        fullPrice: 1000,
        stock: 5,
        widthCm: 10,
        depthCm: 20,
        heightCm: 30,
        deliveryDaysMin: 2,
        deliveryDaysMax: 4,
        isActive: false,
        warehouseStocks: {
          create: { warehouseId: warehouse.id, qty: 5 },
        },
      },
      select: { id: true },
    });
    productId = product.id;
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("owner-critical mutations persist, audit and clean up through the real panel", async ({
    context,
    page,
  }) => {
    if (!adminId || !productId) throw new Error("Fixtures were not created.");

    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);

    await test.step("CMS create and confirmed delete", async () => {
      await page.goto("/admin/sadrzaj", { waitUntil: "domcontentloaded" });
      const form = page
        .locator("form")
        .filter({ has: page.locator('input[name="slug"]') })
        .first();
      await form.locator('input[name="slug"]').fill(fixture.contentSlug);
      await form.locator('input[name="title"]').fill(fixture.contentTitle);
      await form
        .locator('textarea[name="bodyMarkdown"]')
        .fill("## QA\nPrivremeni sadržaj za proveru admin izmena.");
      await form.getByRole("button", { name: "Sačuvaj stranicu" }).click();
      await acceptanceExpect(form.getByRole("status")).toContainText("Sačuvano");
      await expect
        .poll(() =>
          db.contentPage.count({ where: { slug: fixture.contentSlug } }),
        )
        .toBe(1);

      const row = page.locator("tr").filter({ hasText: fixture.contentTitle });
      const deleteButton = row.getByRole("button", { name: "Obriši" });
      await clickConfirmation(page, deleteButton, false);
      await expect
        .poll(() =>
          db.contentPage.count({ where: { slug: fixture.contentSlug } }),
        )
        .toBe(1);
      await clickConfirmation(page, deleteButton, true);
      await expect
        .poll(() =>
          db.contentPage.count({ where: { slug: fixture.contentSlug } }),
        )
        .toBe(0);
    });

    await test.step("category create and product assignment", async () => {
      await page.goto("/admin/kategorije?new=1", {
        waitUntil: "domcontentloaded",
      });
      const form = page
        .locator("form")
        .filter({ has: page.locator('input[name="slug"]') })
        .last();
      await form.locator('input[name="name"]').fill(fixture.categoryName);
      await form.locator('input[name="slug"]').fill(fixture.categorySlug);
      await form.getByRole("button", { name: "Dodaj" }).click();
      await acceptanceExpect(form.getByRole("status")).toContainText(
        "Kategorija je dodata",
      );
      categoryId = await expect
        .poll(async () => {
          const category = await db.category.findUnique({
            where: { slug: fixture.categorySlug },
            select: { id: true },
          });
          return category?.id ?? null;
        })
        .not.toBeNull()
        .then(async () => {
          const category = await db.category.findUniqueOrThrow({
            where: { slug: fixture.categorySlug },
            select: { id: true },
          });
          return category.id;
        });
    });

    await test.step("product fields, price, stock and category", async () => {
      await page.goto(`/admin/proizvodi/${productId}`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("textbox", { name: "Kratki naziv", exact: true })
        .fill(fixture.productUpdatedName);
      await page.getByLabel("Puna cena (RSD)").fill("1299");
      await page.getByLabel("Stanje").fill("7");
      await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
      await acceptanceExpect(page.getByRole("status")).toContainText(
        "Proizvod je sačuvan",
      );
      await expect
        .poll(async () => {
          const product = await db.product.findUniqueOrThrow({
            where: { id: productId! },
            select: {
              name: true,
              shortName: true,
              fullPrice: true,
              stock: true,
            },
          });
          return {
            name: product.name,
            shortName: product.shortName,
            fullPrice: Number(product.fullPrice),
            stock: product.stock,
          };
        })
        .toEqual({
          name: `QA fixture ${fixture.productUpdatedName}`,
          shortName: fixture.productUpdatedName,
          fullPrice: 1299,
          stock: 7,
        });

      await page
        .getByLabel("Promeni kategoriju")
        .selectOption(categoryId!);
      await page
        .getByRole("button", { name: "Sačuvaj kategoriju" })
        .click();
      await acceptanceExpect(page.getByRole("status").last()).toContainText(
        "Kategorija proizvoda je sačuvana",
      );
      await expect
        .poll(() =>
          db.productCategory.count({
            where: { productId: productId!, categoryId: categoryId! },
          }),
        )
        .toBe(1);
    });

    await test.step("product media upload, confirmed delete and storage cleanup", async () => {
      const addForm = page
        .locator("form")
        .filter({
          has: page.getByRole("button", { name: "Dodaj fotografiju" }),
        });
      await addForm
        .locator('input[type="file"]')
        .setInputFiles(path.resolve("public/logo.jpeg"));
      await addForm.locator('input[name="alt"]').fill(fixture.productMediaAlt);
      await addForm
        .getByRole("button", { name: "Dodaj fotografiju" })
        .click();
      await acceptanceExpect(addForm.getByRole("status")).toContainText(
        "Fotografija je dodata",
      );
      const media = await expect
        .poll(async () => {
          const result = await db.productMedia.findFirst({
            where: { productId: productId!, alt: fixture.productMediaAlt },
            select: { id: true, url: true },
          });
          return result;
        })
        .not.toBeNull()
        .then(() =>
          db.productMedia.findFirstOrThrow({
            where: { productId: productId!, alt: fixture.productMediaAlt },
            select: { id: true, url: true },
          }),
        );
      uploadedStorageKeys.add(media.url);

      const bucket = productMediaBucket();
      await expect
        .poll(() => storageObjectExists(supabase, bucket, media.url))
        .toBe(true);

      const deleteForm = page
        .locator("form")
        .filter({
          has: page.locator(
            `input[name="mediaId"][value="${media.id}"]`,
          ),
        })
        .filter({ has: page.getByRole("button", { name: "Obriši" }) });
      const deleteButton = deleteForm.getByRole("button", { name: "Obriši" });
      await clickConfirmation(page, deleteButton, false);
      await expect
        .poll(() =>
          db.productMedia.count({ where: { id: media.id } }),
        )
        .toBe(1);
      await clickConfirmation(page, deleteButton, true);
      await expect
        .poll(() =>
          db.productMedia.count({ where: { id: media.id } }),
        )
        .toBe(0);
      await expect
        .poll(() => storageObjectExists(supabase, bucket, media.url))
        .toBe(false);
      await acceptanceExpect
        .poll(() =>
          db.auditLog.count({
            where: {
              actorId: adminId!,
              action: "product.media.delete",
              entityId: media.id,
            },
          }),
        )
        .toBe(1);
      const deletionAudit = await db.auditLog.findFirstOrThrow({
        where: {
          actorId: adminId!,
          action: "product.media.delete",
          entityId: media.id,
        },
        orderBy: { createdAt: "desc" },
        select: { diff: true },
      });
      expect(
        (deletionAudit.diff as { storageKeys?: string[] })?.storageKeys,
      ).toContain(media.url);
      uploadedStorageKeys.delete(media.url);
    });

    await test.step("delivery rule create and confirmed delete", async () => {
      await page.goto("/admin/dostava", { waitUntil: "domcontentloaded" });
      const form = page
        .locator("form")
        .filter({ has: page.locator('input[name="productId"]') });
      await form.locator('select[name="scope"]').selectOption("PRODUCT");
      await form.locator('input[name="productId"]').fill(productId!);
      await form.locator('input[name="courierPrice"]').fill("321");
      await form.getByRole("button", { name: "Dodaj" }).click();
      await acceptanceExpect(form.getByRole("status")).toContainText(
        "Pravilo dostave je sačuvano",
      );
      deliveryRuleId = await expect
        .poll(async () => {
          const rule = await db.deliveryPriceRule.findFirst({
            where: { productId: productId!, courierPrice: 321 },
            select: { id: true },
          });
          return rule?.id ?? null;
        })
        .not.toBeNull()
        .then(async () => {
          const rule = await db.deliveryPriceRule.findFirstOrThrow({
            where: { productId: productId!, courierPrice: 321 },
            select: { id: true },
          });
          return rule.id;
        });

      const row = page.locator("tr").filter({ hasText: fixture.productSku });
      await clickConfirmation(page, row.locator("button").last(), true);
      await expect
        .poll(() =>
          db.deliveryPriceRule.count({ where: { id: deliveryRuleId! } }),
        )
        .toBe(0);
      deliveryRuleId = null;
    });

    await test.step("voucher create and confirmed delete", async () => {
      await page.goto("/admin/vauceri?new=1", {
        waitUntil: "domcontentloaded",
      });
      const form = page
        .locator("form")
        .filter({ has: page.locator('input[name="amount"]') });
      await form.locator('input[name="code"]').fill(fixture.voucherCode);
      await form.locator('input[name="amount"]').fill("10");
      await form.getByRole("button", { name: "Dodaj" }).click();
      await expect
        .poll(() =>
          db.voucher.count({ where: { code: fixture.voucherCode } }),
        )
        .toBe(1);
      await page.reload({ waitUntil: "domcontentloaded" });
      const row = page.locator("tr").filter({ hasText: fixture.voucherCode });
      await clickConfirmation(page, row.locator("button").last(), true);
      await expect
        .poll(() =>
          db.voucher.count({ where: { code: fixture.voucherCode } }),
        )
        .toBe(0);
    });

    await test.step("payment method toggle and restore", async () => {
      const originalEnabled = originalPaymentConfig?.enabled ?? true;
      await setPaymentEnabled(page, !originalEnabled);
      await expect
        .poll(async () => {
          const config = await db.paymentMethodConfig.findUniqueOrThrow({
            where: { method: PaymentMethod.UPLATA_NA_RACUN },
            select: { enabled: true },
          });
          return config.enabled;
        })
        .toBe(!originalEnabled);
      await setPaymentEnabled(page, originalEnabled);
      await expect
        .poll(async () => {
          const config = await db.paymentMethodConfig.findUniqueOrThrow({
            where: { method: PaymentMethod.UPLATA_NA_RACUN },
            select: { enabled: true },
          });
          return config.enabled;
        })
        .toBe(originalEnabled);
    });

    await test.step("order cancellation restores isolated stock", async () => {
      const warehouse = await db.warehouse.findFirstOrThrow({
        where: { active: true, isDefault: true },
        select: { id: true },
      });
      const order = await db.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: productId! },
          data: { stock: 8 },
        });
        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: warehouse.id,
              productId: productId!,
            },
          },
          data: { qty: 8 },
        });
        return tx.order.create({
          data: {
            number: fixture.orderNumber,
            guestEmail: fixture.orderEmail,
            status: "KREIRANO",
            subtotal: 2598,
            savings: 0,
            shipping: 0,
            assemblyTotal: 0,
            total: 2598,
            shippingMethod: "KURIR",
            paymentMethod: "POUZECE_GOTOVINA",
            shipFirstName: "QA",
            shipLastName: "Kupac",
            shipPhone: "0600000000",
            shipStreet: "Test ulica 1",
            shipCity: "Šabac",
            shipPostalCode: "15000",
            termsAcceptedAt: new Date(),
            items: {
              create: {
                productId: productId!,
                sku: fixture.productSku,
                name: fixture.productUpdatedName,
                qty: 2,
                unitPriceFull: 1299,
                unitPriceSale: 1299,
                warehouseId: warehouse.id,
              },
            },
          },
          select: { id: true },
        });
      });
      orderId = order.id;

      await page.goto(`/admin/narudzbine/${orderId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByLabel("Novi status").selectOption("OTKAZANO");
      await page
        .getByLabel("Napomena")
        .fill(`${tag} kontrolisano otkazivanje`);
      await clickConfirmation(
        page,
        page.getByRole("button", { name: "Sačuvaj", exact: true }).first(),
        true,
      );
      await acceptanceExpect(page.getByRole("status")).toContainText(
        "Status porudžbine je ažuriran",
      );
      await expect
        .poll(async () => {
          const [savedOrder, product] = await Promise.all([
            db.order.findUniqueOrThrow({
              where: { id: orderId! },
              select: {
                status: true,
                stockRestoredAt: true,
                events: { where: { status: "OTKAZANO" } },
              },
            }),
            db.product.findUniqueOrThrow({
              where: { id: productId! },
              select: {
                stock: true,
                warehouseStocks: { select: { qty: true } },
              },
            }),
          ]);
          return {
            status: savedOrder.status,
            restored: Boolean(savedOrder.stockRestoredAt),
            eventCount: savedOrder.events.length,
            productStock: product.stock,
            warehouseStock: product.warehouseStocks.reduce(
              (sum, stock) => sum + stock.qty,
              0,
            ),
          };
        })
        .toEqual({
          status: "OTKAZANO",
          restored: true,
          eventCount: 1,
          productStock: 10,
          warehouseStock: 10,
        });
    });

    await test.step("every accepted mutation has an audit trail", async () => {
      const audit = await db.auditLog.findMany({
        where: { actorId: adminId! },
        select: { action: true },
      });
      const actions = new Set(audit.map((entry) => entry.action));
      for (const action of [
        "content-page.upsert",
        "content-page.delete",
        "category.upsert",
        "product.update",
        "product.category.update",
        "product.media.create",
        "product.media.delete",
        "delivery.upsert",
        "delivery.delete",
        "voucher.upsert",
        "voucher.delete",
        "payment.update",
        "order.statusUpdate",
      ]) {
        expect(actions, `Missing audit action ${action}`).toContain(action);
      }
      expect([...actions].filter((action) => action.endsWith(".error"))).toEqual(
        [],
      );
    });
  });

  async function login(page: Page) {
    const admin = await db.adminUser.findUniqueOrThrow({
      where: { email: fixture.adminEmail },
      select: { enabled: true, passwordHash: true },
    });
    expect(admin.enabled).toBe(true);
    expect(
      await bcrypt.compare(fixture.adminPassword, admin.passwordHash),
    ).toBe(true);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
        waitUntil: "domcontentloaded",
      });
      await page.getByLabel("E-pošta").fill(fixture.adminEmail);
      await page.getByLabel("Lozinka").fill(fixture.adminPassword);
      await page.getByRole("button", { name: "Prijavi se" }).click();
      try {
        await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 });
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  }

  async function setPaymentEnabled(page: Page, enabled: boolean) {
    await page.goto("/admin/placanje", { waitUntil: "domcontentloaded" });
    const card = page
      .getByRole("heading", { name: "Uplata na račun" })
      .locator("xpath=../..");
    const checkbox = card.getByRole("checkbox", {
      name: "Prikaži u checkout-u",
    });
    if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
    await clickConfirmation(
      page,
      card.getByRole("button", { name: "Sačuvaj" }),
      true,
    );
    await acceptanceExpect(card.getByRole("status")).toContainText(
      "Način plaćanja je sačuvan",
    );
  }

  async function cleanup() {
    if (!db) return;

    const existingAdmin = await db.adminUser.findUnique({
      where: { email: fixture.adminEmail },
      select: { id: true },
    });
    const actorId = adminId ?? existingAdmin?.id ?? null;
    const existingOrder = await db.order.findUnique({
      where: { number: fixture.orderNumber },
      select: { id: true },
    });
    const cleanupOrderId = orderId ?? existingOrder?.id ?? null;
    const existingProduct = await db.product.findUnique({
      where: { sku: fixture.productSku },
      select: {
        id: true,
        media: { select: { url: true, thumbUrl: true, cardUrl: true, pdpUrl: true } },
      },
    });
    for (const media of existingProduct?.media ?? []) {
      for (const value of [
        media.url,
        media.thumbUrl,
        media.cardUrl,
        media.pdpUrl,
      ]) {
        if (value && !/^(https?:|data:|blob:|\/)/.test(value)) {
          uploadedStorageKeys.add(value);
        }
      }
    }

    if (cleanupOrderId) {
      await db.backgroundJob.deleteMany({
        where: {
          OR: [
            {
              idempotencyKey: {
                startsWith: `order-status-email:${cleanupOrderId}:`,
              },
            },
            { payload: { path: ["orderId"], equals: cleanupOrderId } },
          ],
        },
      });
    }
    await db.stockMovement.deleteMany({
      where: {
        OR: [
          { sku: fixture.productSku },
          ...(actorId ? [{ actorId }] : []),
        ],
      },
    });
    await db.order.deleteMany({
      where: {
        OR: [
          { number: fixture.orderNumber },
          { guestEmail: fixture.orderEmail },
        ],
      },
    });
    await db.deliveryPriceRule.deleteMany({
      where: existingProduct?.id
        ? { productId: existingProduct.id }
        : { id: deliveryRuleId ?? "__missing__" },
    });
    await db.voucher.deleteMany({
      where: { code: fixture.voucherCode },
    });
    await db.contentPage.deleteMany({
      where: { slug: fixture.contentSlug },
    });
    if (existingProduct?.id) {
      await db.product.delete({ where: { id: existingProduct.id } });
    }
    await db.category.deleteMany({
      where: { slug: fixture.categorySlug },
    });

    if (originalPaymentConfig !== undefined) {
      if (originalPaymentConfig) {
        await db.paymentMethodConfig.upsert({
          where: { method: PaymentMethod.UPLATA_NA_RACUN },
          create: {
            method: PaymentMethod.UPLATA_NA_RACUN,
            ...originalPaymentConfig,
          },
          update: originalPaymentConfig,
        });
      } else {
        await db.paymentMethodConfig.deleteMany({
          where: { method: PaymentMethod.UPLATA_NA_RACUN },
        });
      }
    }

    if (actorId) {
      await db.auditLog.deleteMany({ where: { actorId } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({
      where: { email: fixture.adminEmail },
    });

    if (supabase && uploadedStorageKeys.size) {
      await supabase.storage
        .from(productMediaBucket())
        .remove([...uploadedStorageKeys]);
      uploadedStorageKeys.clear();
    }

    adminId = null;
    productId = null;
    categoryId = null;
    orderId = null;
    deliveryRuleId = null;
  }
});

async function clickConfirmation(
  page: Page,
  locator: Locator,
  accept: boolean,
) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = locator.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message().trim().length).toBeGreaterThan(10);
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
  if (!raw) throw new Error("Database URL is required for admin acceptance.");
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
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}

function createStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Supabase service-role storage access is required.");
  }
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

async function storageObjectExists(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
) {
  const separator = key.lastIndexOf("/");
  const folder = separator >= 0 ? key.slice(0, separator) : "";
  const name = separator >= 0 ? key.slice(separator + 1) : key;
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, { search: name, limit: 100 });
  if (error) throw new Error(error.message);
  return data.some((object) => object.name === name);
}
