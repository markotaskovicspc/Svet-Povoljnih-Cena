import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

test.describe("Faza 1 — završni komentari", () => {
  test.skip(
    process.env.E2E_FAZA1_FINAL !== "1",
    "Set E2E_FAZA1_FINAL=1 and use an isolated E2E schema.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const adminEmail = `qa.faza1.${runId}@example.invalid`;
  const adminPassword = `QaFaza1!${runId}x`;
  const orderNumber = `QA-FAZA1-${runId}`;
  const skuA = `QA-FAZA1-A-${runId}`.slice(0, 90);
  const skuB = `QA-FAZA1-B-${runId}`.slice(0, 90);
  let db: PrismaClient;
  let orderId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const [admin, supplier, warehouse] = await Promise.all([
      db.adminUser.create({
        data: {
          email: adminEmail,
          passwordHash: await bcrypt.hash(adminPassword, 10),
          role: "SUPER",
          enabled: true,
          firstName: "QA",
          lastName: "Faza 1",
        },
      }),
      db.supplier.create({
        data: { name: `QA Faza 1 dobavljač ${runId}`, enabled: false },
      }),
      db.warehouse.create({
        data: {
          code: `QA-F1-${runId}`.slice(0, 40),
          name: `QA Faza 1 DC ${runId}`,
          isDefault: true,
          active: true,
        },
      }),
    ]);
    expect(admin.id).not.toBe("");

    const [productA, productB] = await Promise.all([
      db.product.create({
        data: {
          sku: skuA,
          slug: `qa-faza1-a-${runId}`,
          name: `QA Faza 1 artikal A ${runId}`,
          description: "Privremeni artikal za završnu acceptance proveru.",
          fullPrice: 1_000,
          cogs: 250,
          stock: 10,
          supplierId: supplier.id,
          isActive: false,
        },
      }),
      db.product.create({
        data: {
          sku: skuB,
          slug: `qa-faza1-b-${runId}`,
          name: `QA Faza 1 artikal B ${runId}`,
          description: "Drugi privremeni artikal za raspodelu popusta.",
          fullPrice: 500,
          cogs: 100,
          stock: 0,
          supplierId: supplier.id,
          isActive: false,
        },
      }),
    ]);
    await db.warehouseStock.create({
      data: { warehouseId: warehouse.id, productId: productA.id, qty: 10 },
    });

    const order = await db.order.create({
      data: {
        number: orderNumber,
        channel: "WEB",
        status: "KREIRANO",
        guestEmail: adminEmail,
        subtotal: 2_500,
        savings: 375,
        shipping: 300,
        firstPurchaseDiscount: 375,
        total: 2_425,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Kupac",
        shipPhone: "+381600000000",
        shipStreet: "Test 1",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        termsAcceptedAt: new Date(),
        items: {
          create: [
            {
              productId: productA.id,
              sku: skuA,
              name: productA.name,
              qty: 2,
              unitPriceFull: 1_000,
              unitPriceSale: 1_000,
              warehouseId: warehouse.id,
              warehouseReservedQty: 2,
            },
            {
              productId: productB.id,
              sku: skuB,
              name: productB.name,
              qty: 1,
              unitPriceFull: 500,
              unitPriceSale: 500,
              warehouseId: warehouse.id,
              warehouseReservedQty: 1,
            },
          ],
        },
      },
      include: { items: { orderBy: { sku: "asc" } } },
    });
    orderId = order.id;

    const sale = await db.fiscalDocument.create({
      data: {
        orderId,
        kind: "SALE",
        status: "ISSUED",
        source: "MANUAL",
        warehouseId: warehouse.id,
        receiptNumber: `QA-F1-SALE-${runId}`,
        idempotencyKey: `qa-faza1-sale:${runId}`,
        totalNet: 1_770.84,
        totalVat: 354.16,
        totalGross: 2_125,
        issuedAt: new Date(),
      },
    });
    await db.fiscalDocumentLine.create({
      data: {
        fiscalDocumentId: sale.id,
        orderItemId: order.items[0]!.id,
        productId: productA.id,
        orderNumber,
        customerName: "QA Kupac",
        address: "Test 1",
        city: "Beograd",
        postalCode: "11000",
        phone: "+381600000000",
        email: adminEmail,
        sku: skuA,
        shortName: productA.name,
        qty: 2,
        refundedQty: 1,
        unitPriceGross: 850,
        totalNet: 1_416.67,
        totalVat: 283.33,
        totalGross: 1_700,
      },
    });
    const refund = await db.fiscalDocument.create({
      data: {
        orderId,
        kind: "REFUND",
        status: "ISSUED",
        source: "REFUND",
        warehouseId: warehouse.id,
        receiptNumber: `QA-F1-REFUND-${runId}`,
        idempotencyKey: `qa-faza1-refund:${runId}`,
        totalNet: 708.33,
        totalVat: 141.67,
        totalGross: 850,
        issuedAt: new Date(),
      },
    });
    await Promise.all([
      db.paymentRefund.create({
        data: {
          orderId,
          fiscalDocumentId: refund.id,
          method: "POUZECE_GOTOVINA",
          provider: "MANUAL",
          status: "COMPLETED",
          amount: 850,
          completedAt: new Date(),
        },
      }),
      db.invoice.create({
        data: {
          orderId,
          kind: "PROFORMA",
          status: "ISSUED",
          number: `QA-F1-PROFORMA-${runId}`,
          total: 2_425,
        },
      }),
      db.purchaseOrder.create({
        data: {
          number: `QA-F1-PO-${runId}`,
          status: "DRAFT",
          supplierId: supplier.id,
          receivingWarehouseId: warehouse.id,
          totalPrice: 1_000,
          items: {
            create: {
              productId: productA.id,
              sku: skuA,
              name: productA.name,
              purchasePrice: 100,
              qty: 10,
              receivedQty: 0,
            },
          },
        },
      }),
    ]);
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("admin vidi tačne finansijske, refund i COGS podatke i menja uplatu kurira", async ({
    page,
  }) => {
    await login(page, "/admin/erp/prodajni-nalozi");
    await expect(
      page.getByRole("heading", { name: "Pregled porudžbina", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-client-ready="true"]')).toBeVisible();
    await page
      .getByPlaceholder("Brza pretraga po vidljivim kolonama")
      .fill(orderNumber);

    const summary = page.getByLabel("Zbir svih filtriranih porudžbina");
    await expect(summary).toContainText("1 naloga");
    await expect(summary).toContainText("2.020,84 RSD");
    await expect(summary).toContainText("2.425,00 RSD");

    const orderRow = page.getByRole("row").filter({ hasText: skuA }).first();
    await expect(
      orderRow.getByRole("checkbox", { name: /^Refundirano / }),
    ).toBeChecked();
    for (const heading of [
      "Kurir uplatio pouzeće",
      "Datum uplate kurira",
      "Refundirano kom",
      "Datum fiskalnog refunda",
      "Datum povrata novca",
    ]) {
      await expect(
        page.getByRole("columnheader").filter({
          has: page.getByRole("button", { name: heading, exact: true }),
        }),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "Uredi podržana polja" }).click();
    await orderRow
      .getByRole("checkbox", { name: /^Kurir uplatio pouzeće / })
      .check();
    await expect
      .poll(async () =>
        (
          await db.order.findUniqueOrThrow({
            where: { id: orderId },
            select: { courierPaidAt: true },
          })
        ).courierPaidAt,
      )
      .not.toBeNull();
    const refreshedCourierPaid = page
      .getByRole("row")
      .filter({ hasText: skuA })
      .first()
      .getByRole("checkbox", { name: /^Kurir uplatio pouzeće / });
    await expect(refreshedCourierPaid).toBeChecked();
    await refreshedCourierPaid.uncheck();
    await expect
      .poll(async () =>
        (
          await db.order.findUniqueOrThrow({
            where: { id: orderId },
            select: { courierPaidAt: true },
          })
        ).courierPaidAt,
      )
      .toBeNull();

    await page.goto("/admin/erp/stanje-po-magacinima", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("link", { name: "Stanje i artikli" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { name: "Ručna korekcija" })).toHaveCount(0);
    const stockRow = page.getByRole("row").filter({ hasText: skuA }).first();
    await expect(stockRow).toContainText("10");
    await expect(stockRow).toContainText("3");
    await expect(stockRow).toContainText("7");
    await expect(stockRow).toContainText("2.500");

    await page.getByRole("link", { name: "Upravljanje lagerom" }).click();
    await expect(page.getByRole("heading", { name: "Ručna korekcija" })).toBeVisible();

    await page.goto("/admin/erp/artikli", { waitUntil: "domcontentloaded" });
    await page
      .getByPlaceholder("Brza pretraga po vidljivim kolonama")
      .fill(skuA);
    await expect(
      page.getByRole("columnheader").filter({
        has: page.getByRole("button", { name: "COGS vrednost", exact: true }),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: skuA }).first(),
    ).toContainText("2.500");
  });

  async function login(page: Page, callbackUrl: string) {
    await page.goto(
      `/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(
      new RegExp(callbackUrl.replaceAll("/", "\\/")),
      { timeout: 30_000 },
    );
  }
});

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is required for Faza 1 acceptance.");
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
