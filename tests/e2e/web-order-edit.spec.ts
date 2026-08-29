// Acceptance: MARKO-89
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("bezbedna izmena WEB porudžbine", () => {
  test.skip(
    process.env.E2E_WEB_ORDER_EDIT !== "1",
    "Set E2E_WEB_ORDER_EDIT=1 with an isolated E2E database.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const prefix = `QA-WEB-EDIT-${runId}`;
  const adminEmail = `${prefix.toLowerCase()}@example.invalid`;
  const adminPassword = `QaWebEdit!${runId}x`;
  const orderNumber = `${prefix}-ORDER`;
  const skus = [`${prefix}-A`, `${prefix}-B`, `${prefix}-C`] as const;
  let db: PrismaClient;
  let adminId = "";
  let orderId = "";
  let warehouseId = "";
  let createdWarehouse = false;
  let groupId = "";
  let parentCategoryId = "";
  let childCategoryId = "";
  let priceListId = "";
  const productIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "WEB edit",
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
          code: `${prefix}-DC`.slice(0, 40),
          name: `${prefix} magacin`,
          active: true,
          isDefault: true,
        },
        select: { id: true },
      });
      createdWarehouse = true;
    }
    warehouseId = warehouse.id;

    const group = await db.group.create({
      data: {
        slug: `${prefix}-group`.toLowerCase(),
        name: `${prefix} grupa`,
      },
      select: { id: true },
    });
    groupId = group.id;
    const parentCategory = await db.category.create({
      data: {
        slug: `${prefix}-parent`.toLowerCase(),
        name: `${prefix} kategorija`,
        path: `/${prefix.toLowerCase()}-parent`,
        level: 0,
      },
      select: { id: true, path: true },
    });
    parentCategoryId = parentCategory.id;
    const childCategory = await db.category.create({
      data: {
        slug: `${prefix}-child`.toLowerCase(),
        name: `${prefix} potkategorija`,
        path: `${parentCategory.path}/${prefix.toLowerCase()}-child`,
        level: 1,
        parentId: parentCategory.id,
      },
      select: { id: true },
    });
    childCategoryId = childCategory.id;
    const priceList = await db.priceList.create({
      data: {
        code: `${prefix}-RETAIL`,
        name: `${prefix} WEB cenovnik`,
        kind: "RETAIL",
        active: true,
      },
      select: { id: true },
    });
    priceListId = priceList.id;

    for (const [index, sku] of skus.entries()) {
      const fullPrice = index === 0 ? 1_200 : index === 1 ? 500 : 700;
      const product = await db.product.create({
        data: {
          sku,
          slug: `${prefix}-${index}`.toLowerCase(),
          name: `${prefix} artikal ${index + 1}`,
          description: "Privremeni acceptance artikal za izmenu WEB porudžbine.",
          fullPrice,
          salePrice: index === 0 ? 1_000 : null,
          stock: 10,
          dcAvailableQty: 10,
          isActive: true,
          availableWebAuto: true,
          groupId,
          unitPackWidthCm: 10,
          unitPackDepthCm: 10,
          unitPackHeightCm: 10,
          categories: {
            create: { categoryId: childCategoryId },
          },
          priceListEntries: {
            create: {
              priceListId,
              price: fullPrice,
              validFrom: new Date(Date.now() - 60_000),
            },
          },
          warehouseStocks: {
            create: { warehouseId, qty: 10 },
          },
        },
        select: { id: true },
      });
      productIds.push(product.id);
    }

    const order = await db.order.create({
      data: {
        number: orderNumber,
        guestEmail: `${prefix.toLowerCase()}.buyer@example.invalid`,
        status: "KREIRANO",
        channel: "WEB",
        subtotal: 2_500,
        savings: 400,
        shipping: 0,
        assemblyTotal: 0,
        total: 2_500,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Kupac",
        shipCompanyName: "QA Kupac d.o.o.",
        shipPib: "109876543",
        shipPhone: "+381641112223",
        shipStreet: "Test ulica 1",
        shipCity: "Novi Sad",
        shipPostalCode: "21000",
        termsAcceptedAt: new Date(),
        items: {
          create: [
            {
              productId: productIds[0],
              sku: skus[0],
              name: `${prefix} artikal 1`,
              qty: 2,
              unitPriceFull: 1_200,
              unitPriceSale: 1_000,
              warehouseId,
              warehouseReservedQty: 2,
            },
            {
              productId: productIds[1],
              sku: skus[1],
              name: `${prefix} artikal 2`,
              qty: 1,
              unitPriceFull: 500,
              unitPriceSale: 500,
              warehouseId,
              warehouseReservedQty: 1,
            },
          ],
        },
        payments: {
          create: {
            method: "POUZECE_GOTOVINA",
            provider: "COD",
            status: "PENDING",
            amount: 2_500,
          },
        },
      },
      select: { id: true },
    });
    orderId = order.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (orderId) {
      await db.backgroundJob.deleteMany({
        where: {
          OR: [
            { idempotencyKey: { contains: orderId } },
            { payload: { path: ["orderId"], equals: orderId } },
          ],
        },
      });
      await db.order.deleteMany({ where: { id: orderId } });
    }
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
    }
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    if (priceListId) {
      await db.priceList.deleteMany({ where: { id: priceListId } });
    }
    if (childCategoryId) {
      await db.category.deleteMany({ where: { id: childCategoryId } });
    }
    if (parentCategoryId) {
      await db.category.deleteMany({ where: { id: parentCategoryId } });
    }
    if (groupId) {
      await db.group.deleteMany({ where: { id: groupId } });
    }
    if (createdWarehouse && warehouseId) {
      await db.warehouse.deleteMany({ where: { id: warehouseId } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
    await db.$disconnect();
  });

  test("ispravlja adresu i telefon uz audit trag", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/erp/prodajni-nalozi/${orderId}`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByText("Izmeni adresu", { exact: true }).click();
    const addressForm = page.getByTestId("shipping-address-edit-form");
    await addressForm.getByLabel("Ulica i broj").fill("Test ulica 22");
    await addressForm.getByLabel("Grad / mesto").fill("Novi Sad");
    await addressForm.getByLabel("Poštanski broj").fill("21000");
    await clickConfirmation(
      page,
      addressForm.getByRole("button", { name: "Sačuvaj adresu" }),
    );
    await expect(addressForm.getByRole("status")).toContainText(
      "Adresa isporuke je izmenjena",
      { timeout: 90_000 },
    );
    await expect
      .poll(async () => {
        const row = await db.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { shipStreet: true, shipCity: true, shipPostalCode: true },
        });
        return `${row.shipStreet}|${row.shipPostalCode}|${row.shipCity}`;
      })
      .toBe("Test ulica 22|21000|Novi Sad");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Izmeni broj telefona", { exact: true }).click();
    const phoneForm = page.getByTestId("shipping-phone-edit-form");
    await phoneForm.getByLabel("Broj telefona").fill("060 332 63 25");
    await clickConfirmation(
      page,
      phoneForm.getByRole("button", { name: "Sačuvaj broj telefona" }),
    );
    await expect(phoneForm.getByRole("status")).toContainText(
      "Broj telefona za isporuku je izmenjen",
      { timeout: 90_000 },
    );
    await expect
      .poll(() =>
        db.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { shipPhone: true },
        }),
      )
      .toEqual({ shipPhone: "0603326325" });
    await expect
      .poll(() =>
        db.auditLog.count({
          where: {
            actorId: adminId,
            action: {
              in: ["order.shippingAddressUpdate", "order.shippingPhoneUpdate"],
            },
            entity: "Order",
          },
        }),
      )
      .toBe(2);
  });

  test("menja način plaćanja i čuva istoriju pokušaja", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/erp/prodajni-nalozi/${orderId}`, {
      waitUntil: "domcontentloaded",
    });

    let paymentForm = page.getByTestId("web-order-payment-method-form");
    await paymentForm
      .getByLabel("Novi način plaćanja")
      .selectOption("UPLATA_NA_RACUN");
    await clickConfirmation(
      page,
      paymentForm.getByRole("button", { name: "Promeni način plaćanja" }),
    );
    await expect(paymentForm.getByRole("status")).toContainText(
      "Pouzeće — gotovina → Uplata na račun",
      { timeout: 90_000 },
    );
    await expect
      .poll(async () => {
        const order = await db.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { payments: { orderBy: { createdAt: "desc" } } },
        });
        return {
          method: order.paymentMethod,
          latestMethod: order.payments[0]?.method,
          latestStatus: order.payments[0]?.status,
          failedAttempts: order.payments.filter(
            (payment) => payment.status === "FAILED",
          ).length,
        };
      })
      .toEqual({
        method: "UPLATA_NA_RACUN",
        latestMethod: "UPLATA_NA_RACUN",
        latestStatus: "PENDING",
        failedAttempts: 1,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    paymentForm = page.getByTestId("web-order-payment-method-form");
    await paymentForm
      .getByLabel("Novi način plaćanja")
      .selectOption("POUZECE_GOTOVINA");
    await clickConfirmation(
      page,
      paymentForm.getByRole("button", { name: "Promeni način plaćanja" }),
    );
    await expect(paymentForm.getByRole("status")).toContainText(
      "Uplata na račun → Pouzeće — gotovina",
      { timeout: 90_000 },
    );
    await expect
      .poll(async () => {
        const order = await db.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { payments: { orderBy: { createdAt: "desc" } } },
        });
        return {
          method: order.paymentMethod,
          latestMethod: order.payments[0]?.method,
          latestStatus: order.payments[0]?.status,
          failedAttempts: order.payments.filter(
            (payment) => payment.status === "FAILED",
          ).length,
        };
      })
      .toEqual({
        method: "POUZECE_GOTOVINA",
        latestMethod: "POUZECE_GOTOVINA",
        latestStatus: "PENDING",
        failedAttempts: 2,
      });
    await expect
      .poll(() =>
        db.auditLog.count({
          where: {
            actorId: adminId,
            action: "order.webPaymentMethodUpdate",
            entity: "Payment",
          },
        }),
      )
      .toBe(2);
  });

  test("dodaje novi WEB artikal i povećava postojeći red", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/erp/prodajni-nalozi/${orderId}`, {
      waitUntil: "domcontentloaded",
    });

    let addForm = page.getByTestId("web-order-item-add-form");
    await addForm.getByLabel("Šifra artikla za dodavanje").fill(skus[2]);
    await addForm.getByLabel("Količina artikla za dodavanje").fill("2");
    await clickConfirmation(
      page,
      addForm.getByRole("button", { name: "Dodaj artikal" }),
    );
    await expect(addForm.getByRole("status")).toContainText(
      `Artikal ${skus[2]} je dodat`,
      { timeout: 90_000 },
    );
    await expect
      .poll(() => readState(), { timeout: 30_000 })
      .toMatchObject({
        quantities: { [skus[0]]: 2, [skus[1]]: 1, [skus[2]]: 2 },
        reservations: { [skus[0]]: 2, [skus[1]]: 1, [skus[2]]: 2 },
        subtotal: 3_900,
        savings: 400,
        paymentMatchesTotal: true,
        invoiceMatchesTotal: true,
        itemChangeEmailJobs: 1,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    addForm = page.getByTestId("web-order-item-add-form");
    await addForm.getByLabel("Šifra artikla za dodavanje").fill(skus[2]);
    await addForm.getByLabel("Količina artikla za dodavanje").fill("1");
    await clickConfirmation(
      page,
      addForm.getByRole("button", { name: "Dodaj artikal" }),
    );
    await expect(addForm.getByRole("status")).toContainText(
      `Količina artikla ${skus[2]} je povećana (2 → 3)`,
      { timeout: 90_000 },
    );
    await expect
      .poll(() => readState(), { timeout: 30_000 })
      .toMatchObject({
        quantities: { [skus[0]]: 2, [skus[1]]: 1, [skus[2]]: 3 },
        reservations: { [skus[2]]: 3 },
        subtotal: 4_600,
        paymentMatchesTotal: true,
        invoiceMatchesTotal: true,
        itemChangeEmailJobs: 2,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    const addedRow = page.locator("tr").filter({ hasText: skus[2] });
    await addedRow.getByLabel(`Nova količina za ${skus[2]}`).fill("0");
    await clickConfirmation(
      page,
      addedRow.getByRole("button", { name: "Sačuvaj" }),
    );
    await expect(addedRow).toHaveCount(0, { timeout: 90_000 });
    await expect
      .poll(() => readState(), { timeout: 30_000 })
      .toMatchObject({
        quantities: { [skus[0]]: 2, [skus[1]]: 1 },
        reservations: { [skus[0]]: 2, [skus[1]]: 1 },
        subtotal: 2_500,
        savings: 400,
        paymentMatchesTotal: true,
        invoiceMatchesTotal: true,
        itemChangeEmailJobs: 3,
      });

    await db.backgroundJob.deleteMany({
      where: {
        kind: "ORDER_ITEMS_CHANGED_EMAIL",
        payload: { path: ["orderId"], equals: orderId },
      },
    });
    await db.orderStatusEvent.deleteMany({
      where: { orderId, note: { contains: skus[2] } },
    });
    await db.auditLog.deleteMany({
      where: {
        actorId: adminId,
        entity: "OrderItem",
        action: { in: ["order.webItemAdd", "order.webItemUpdate"] },
      },
    });
  });

  test("smanjuje količinu, briše drugi red i sinhronizuje sve tragove", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/admin/erp/prodajni-nalozi/${orderId}`, {
      waitUntil: "domcontentloaded",
    });

    const firstRow = page.locator("tr").filter({ hasText: skus[0] });
    await expect(firstRow.getByLabel(`Nova količina za ${skus[0]}`)).toHaveValue(
      "1",
    );
    await clickConfirmation(
      page,
      firstRow.getByRole("button", { name: "Sačuvaj" }),
    );
    await expect(firstRow.getByRole("status")).toContainText(
      "rezervacije, iznosi i predračun su osveženi",
      { timeout: 90_000 },
    );
    await expect
      .poll(() => readState())
      .toMatchObject({
        quantities: { [skus[0]]: 1, [skus[1]]: 1 },
        reservations: { [skus[0]]: 1, [skus[1]]: 1 },
        productStocks: { [skus[0]]: 10, [skus[1]]: 10 },
        warehouseStocks: { [skus[0]]: 10, [skus[1]]: 10 },
        subtotal: 1_500,
        savings: 200,
        paymentMatchesTotal: true,
        invoiceMatchesTotal: true,
        invoiceStatus: "ISSUED",
        invoiceEmailedAt: null,
        itemChangeEmailJobs: 1,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    const secondRow = page.locator("tr").filter({ hasText: skus[1] });
    await expect(
      secondRow.getByLabel(`Nova količina za ${skus[1]}`),
    ).toHaveValue("0");
    await clickConfirmation(
      page,
      secondRow.getByRole("button", { name: "Sačuvaj" }),
    );
    await expect(secondRow).toHaveCount(0, { timeout: 90_000 });
    await expect
      .poll(
        () =>
          db.auditLog.count({
            where: {
              actorId: adminId,
              action: "order.webItemUpdate",
              entity: "OrderItem",
            },
          }),
        { timeout: 90_000 },
      )
      .toBe(2);
    await expect
      .poll(() => readState(), { timeout: 30_000 })
      .toMatchObject({
        quantities: { [skus[0]]: 1 },
        reservations: { [skus[0]]: 1 },
        productStocks: { [skus[0]]: 10, [skus[1]]: 10 },
        warehouseStocks: { [skus[0]]: 10, [skus[1]]: 10 },
        subtotal: 1_000,
        savings: 200,
        paymentMatchesTotal: true,
        invoiceMatchesTotal: true,
        itemChangeEmailJobs: 2,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    const remainingRow = page.locator("tr").filter({ hasText: skus[0] });
    await expect(
      remainingRow.getByRole("button", { name: "Otkaži nalog" }),
    ).toBeVisible();
    await expect(remainingRow.getByRole("button", { name: "Sačuvaj" })).toHaveCount(0);

    const events = await db.orderStatusEvent.findMany({
      where: { orderId, note: { contains: "WEB stavka" } },
      select: { actorId: true, note: true },
    });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.actorId === adminId)).toBe(true);
    await expect
      .poll(() =>
        db.auditLog.count({
          where: {
            actorId: adminId,
            action: "order.webItemUpdate",
            entity: "OrderItem",
          },
        }),
      )
      .toBe(2);

    await db.order.update({
      where: { id: orderId },
      data: { status: "ISPORUCENO" },
    });
    await page.goto("/admin/erp/reklamacije-dnevnik", {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByText("+ Ručno evidentiraj reklamaciju", { exact: false })
      .click();
    const partialOrderDigits = runId.split("-").at(-1)!;
    await page
      .getByRole("combobox", {
        name: "Broj porudžbine ili fiskalnog računa",
      })
      .fill(partialOrderDigits);
    await page.getByRole("option", { name: new RegExp(orderNumber) }).click();
    const itemSelect = page.getByLabel("Artikal sa porudžbine");
    await expect(itemSelect).toContainText(skus[0]);
    await expect(itemSelect).not.toContainText(skus[1]);
    await itemSelect.selectOption(skus[0]);
    await expect(itemSelect).toHaveValue(skus[0]);
  });

  async function readState() {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: true,
        payments: { orderBy: { createdAt: "desc" } },
        invoices: { where: { kind: "PROFORMA" } },
      },
    });
    const quantities = Object.fromEntries(
      order.items.map((item) => [item.sku, item.qty]),
    );
    const reservations = Object.fromEntries(
      order.items.map((item) => [item.sku, item.warehouseReservedQty]),
    );
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      include: { warehouseStocks: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const normalizedProductStocks = Object.fromEntries(
      skus.map((sku, index) => [sku, productById.get(productIds[index]!)?.stock]),
    );
    const warehouseStocks = Object.fromEntries(
      skus.map((sku, index) => [
        sku,
        productById
          .get(productIds[index]!)
          ?.warehouseStocks.find((stock) => stock.warehouseId === warehouseId)
          ?.qty,
      ]),
    );
    const payment = order.payments.find(
      (candidate) => candidate.status === "PENDING",
    );
    const invoice = order.invoices[0];
    const itemChangeEmailJobs = await db.backgroundJob.count({
      where: {
        kind: "ORDER_ITEMS_CHANGED_EMAIL",
        payload: { path: ["orderId"], equals: orderId },
      },
    });
    return {
      quantities,
      reservations,
      productStocks: normalizedProductStocks,
      warehouseStocks,
      subtotal: Number(order.subtotal),
      savings: Number(order.savings),
      paymentMatchesTotal:
        Boolean(payment) && Number(payment?.amount) === Number(order.total),
      invoiceMatchesTotal:
        Boolean(invoice) && Number(invoice?.total) === Number(order.total),
      invoiceStatus: invoice?.status,
      invoiceEmailedAt: invoice?.emailedAt ?? null,
      itemChangeEmailJobs,
    };
  }

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin(?:[?#]|$)/, { timeout: 90_000 });
  }
});

async function clickConfirmation(page: Page, button: Locator) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = button.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  await dialog.accept();
  await clickPromise;
}

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is required for WEB-order edit acceptance.");
  }
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url.toString(),
        max: 1,
        connectionTimeoutMillis: 15_000,
      },
      { schema },
    ),
  });
}
