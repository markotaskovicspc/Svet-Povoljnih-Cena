import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { validateVoucher } from "@/lib/api/vouchers";

test.describe("isolated voucher lifecycle", () => {
  test.skip(
    process.env.E2E_VOUCHERS !== "1",
    "Run through npm run test:e2e:vouchers:isolated.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const compactRunId = runId.replaceAll("-", "");
  const fixture = {
    adminEmail: `qa.voucher.${runId}@example.invalid`,
    adminPassword: `QaVoucher!${runId}`,
    adminCode: `QAADMIN${compactRunId}`.slice(0, 40),
    percentCode: `QAPCT${compactRunId}`.slice(0, 40),
    fixedCode: `QAFIX${compactRunId}`.slice(0, 40),
    inactiveCode: `QAOFF${compactRunId}`.slice(0, 40),
    futureCode: `QAFUT${compactRunId}`.slice(0, 40),
    expiredCode: `QAEXP${compactRunId}`.slice(0, 40),
    minimumCode: `QAMIN${compactRunId}`.slice(0, 40),
    reservationCode: `QARES${compactRunId}`.slice(0, 40),
    perUserCode: `QAUSR${compactRunId}`.slice(0, 40),
    checkoutCode: `QACHECK${compactRunId}`.slice(0, 40),
    uiCode: `QAUI${compactRunId}`.slice(0, 40),
    sku: `QA-VOUCHER-${runId}`.slice(0, 80),
    townId: 990_001,
  };

  let db: PrismaClient;
  let userId = "";
  let bareOrderSequence = 0;

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const defaultWarehouse = await db.warehouse.upsert({
      where: { code: "DC" },
      create: {
        code: "DC",
        name: "QA distributivni centar",
        active: true,
        isDefault: true,
      },
      update: { active: true, isDefault: true },
      select: { id: true },
    });
    await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash: await bcrypt.hash(fixture.adminPassword, 12),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Voucher",
      },
    });
    const user = await db.user.create({
      data: { email: `qa.voucher.customer.${runId}@example.invalid` },
      select: { id: true },
    });
    userId = user.id;
    await db.xExpressTown.upsert({
      where: { id: fixture.townId },
      create: {
        id: fixture.townId,
        name: "Beograd",
        displayName: "Beograd - 11000",
        postalCode: "11000",
        active: true,
      },
      update: {
        name: "Beograd",
        displayName: "Beograd - 11000",
        postalCode: "11000",
        active: true,
      },
    });
    await db.product.create({
      data: {
        sku: fixture.sku,
        slug: fixture.sku.toLowerCase(),
        name: "QA voucher proizvod",
        description: "Privremeni proizvod u izolovanoj voucher bazi.",
        shortDescription: "QA voucher",
        fullPrice: 1_000,
        stock: 10,
        dcAvailableQty: 10,
        widthCm: 10,
        depthCm: 10,
        heightCm: 10,
        unitPackWidthCm: 10,
        unitPackDepthCm: 10,
        unitPackHeightCm: 10,
        grossWeightKg: 1,
        isActive: true,
        availableWebManual: true,
        availableWebAuto: true,
        warehouseStocks: {
          create: { warehouseId: defaultWarehouse.id, qty: 10 },
        },
      },
      select: { id: true },
    });
    const now = Date.now();
    await db.voucher.createMany({
      data: [
        { code: fixture.percentCode, kind: "PERCENT", amount: 15 },
        { code: fixture.fixedCode, kind: "FIXED", amount: 500 },
        { code: fixture.inactiveCode, kind: "PERCENT", amount: 10, active: false },
        {
          code: fixture.futureCode,
          kind: "PERCENT",
          amount: 10,
          startsAt: new Date(now + 86_400_000),
        },
        {
          code: fixture.expiredCode,
          kind: "PERCENT",
          amount: 10,
          endsAt: new Date(now - 86_400_000),
        },
        {
          code: fixture.minimumCode,
          kind: "PERCENT",
          amount: 10,
          minSubtotal: 2_000,
        },
        {
          code: fixture.reservationCode,
          kind: "PERCENT",
          amount: 10,
          usageLimit: 1,
        },
        {
          code: fixture.perUserCode,
          kind: "PERCENT",
          amount: 10,
          perUserLimit: 1,
        },
        {
          code: fixture.checkoutCode,
          kind: "PERCENT",
          amount: 15,
          usageLimit: 1,
        },
        { code: fixture.uiCode, kind: "PERCENT", amount: 15 },
      ],
    });
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("admin creates and edits every supported voucher field", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3021",
      },
    ]);
    await loginAdmin(page);
    await page.goto("/admin/vauceri?new=1", { waitUntil: "domcontentloaded" });
    const form = page
      .locator("form")
      .filter({ has: page.locator('input[name="amount"]') });
    await form.locator('input[name="code"]').fill(fixture.adminCode.toLowerCase());
    await form.locator('select[name="kind"]').selectOption("PERCENT");
    await form.locator('input[name="amount"]').fill("25");
    await form.locator('input[name="minSubtotal"]').fill("1500");
    await form
      .locator('input[name="startsAt"]')
      .fill(new Date(Date.now() - 86_400_000).toISOString().slice(0, 16));
    await form
      .locator('input[name="endsAt"]')
      .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
    await form.locator('input[name="usageLimit"]').fill("5");
    await form.locator('input[name="perUserLimit"]').fill("2");
    await form.getByRole("button", { name: "Dodaj" }).click();

    await expect
      .poll(() =>
        db.voucher.findUnique({
          where: { code: fixture.adminCode },
          select: {
            kind: true,
            amount: true,
            minSubtotal: true,
            startsAt: true,
            endsAt: true,
            usageLimit: true,
            perUserLimit: true,
            active: true,
          },
        }),
      )
      .toMatchObject({
        kind: "PERCENT",
        usageLimit: 5,
        perUserLimit: 2,
        active: true,
      });

    await page.goto(`/admin/vauceri?edit=${fixture.adminCode}`, {
      waitUntil: "domcontentloaded",
    });
    const editForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="amount"]') });
    await expect(editForm.locator('input[name="code"]')).toHaveAttribute(
      "readonly",
      "",
    );
    await editForm.locator('select[name="kind"]').selectOption("FIXED");
    await editForm.locator('input[name="amount"]').fill("350");
    await editForm.locator('input[name="active"]').uncheck();
    await editForm.getByRole("button", { name: "Sačuvaj" }).click();
    await expect
      .poll(async () => {
        const voucher = await db.voucher.findUniqueOrThrow({
          where: { code: fixture.adminCode },
          select: { kind: true, amount: true, active: true },
        });
        return {
          kind: voucher.kind,
          amount: Number(voucher.amount),
          active: voucher.active,
        };
      })
      .toEqual({ kind: "FIXED", amount: 350, active: false });
  });

  test("validation covers percent, fixed, dates, minimum and reservation limits", async ({
    request,
  }) => {
    await expectVoucher(request, `  ${fixture.percentCode.toLowerCase()}  `, 333, {
      ok: true,
      code: fixture.percentCode,
      discountRsd: 50,
      kind: "percent",
    });
    await expectVoucher(request, fixture.fixedCode, 300, {
      ok: true,
      discountRsd: 300,
      kind: "fixed",
    });
    await expectVoucher(request, fixture.minimumCode, 1_999, {
      ok: false,
      reason: /preko 2.*000 RSD/,
    });
    await expectVoucher(request, fixture.minimumCode, 2_000, {
      ok: true,
      discountRsd: 200,
    });
    await expectVoucher(request, fixture.inactiveCode, 1_000, {
      ok: false,
      reason: /nije pronađen|istekao/,
    });
    await expectVoucher(request, fixture.futureCode, 1_000, {
      ok: false,
      reason: /još nije aktivan/,
    });
    await expectVoucher(request, fixture.expiredCode, 1_000, {
      ok: false,
      reason: /istekao/,
    });
    await expectVoucher(request, `NOPE${compactRunId}`, 1_000, {
      ok: false,
      reason: /nije pronađen|istekao/,
    });

    const reservedOrder = await createBareOrder({
      status: "KREIRANO",
      userId: null,
      voucherCode: fixture.reservationCode,
    });
    await db.voucherRedemption.create({
      data: {
        voucherCode: fixture.reservationCode,
        orderId: reservedOrder.id,
        amount: 100,
      },
    });
    await expectVoucher(request, fixture.reservationCode, 1_000, {
      ok: false,
      reason: /iskorišćen|rezervisan/,
    });
    await db.order.update({
      where: { id: reservedOrder.id },
      data: { status: "OTKAZANO" },
    });
    await expectVoucher(request, fixture.reservationCode, 1_000, {
      ok: true,
      discountRsd: 100,
    });
    await db.fiscalDocument.create({
      data: {
        orderId: reservedOrder.id,
        kind: "SALE",
        status: "ISSUED",
        idempotencyKey: `qa-voucher-issued-${runId}`,
        issuedAt: new Date(),
      },
    });
    await expectVoucher(request, fixture.reservationCode, 1_000, {
      ok: false,
      reason: /iskorišćen|rezervisan/,
    });

    const perUserOrder = await createBareOrder({
      status: "KREIRANO",
      userId,
      voucherCode: fixture.perUserCode,
    });
    await db.voucherRedemption.create({
      data: {
        voucherCode: fixture.perUserCode,
        orderId: perUserOrder.id,
        userId,
        amount: 100,
      },
    });
    await expect(validateVoucher(fixture.perUserCode, 1_000, userId)).resolves.toMatchObject({
      ok: false,
      reason: "Već ste iskoristili ovaj vaučer",
    });
    await expect(validateVoucher(fixture.perUserCode, 1_000, null)).resolves.toMatchObject({
      ok: true,
      discountRsd: 100,
    });
    await db.order.update({
      where: { id: perUserOrder.id },
      data: { status: "OTKAZANO" },
    });
    await expect(validateVoucher(fixture.perUserCode, 1_000, userId)).resolves.toMatchObject({
      ok: true,
      discountRsd: 100,
    });
  });

  test("cart voucher survives checkout navigation and reload and reaches final payload", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3021",
      },
    ]);
    await page.addInitScript(({ sku }) => {
      window.localStorage.setItem(
        "spc-cart",
        JSON.stringify({
          state: {
            lines: [
              {
                sku,
                name: "QA voucher proizvod",
                slug: sku.toLowerCase(),
                qty: 1,
                unitPriceFull: 1_000,
                unitPriceSale: 1_000,
              },
            ],
          },
          version: 0,
        }),
      );
    }, { sku: fixture.sku });
    await installCheckoutRouteMocks(page);

    let submittedPayload: Record<string, unknown> | null = null;
    await page.route("**/api/checkout/order", async (route) => {
      submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            id: `qa-ui-order-${runId}`,
            number: `QA-UI-${runId}`,
            accessToken: `qa-ui-token-${runId}`,
            total: 1_840,
            subtotal: 1_000,
            savings: 0,
            shipping: 990,
            assemblyTotal: 0,
            paymentMethod: "POUZECE_GOTOVINA",
            shippingMethod: "KURIR",
            voucherDiscount: 150,
            firstPurchaseDiscount: 0,
            savedCardDiscount: 0,
          },
        }),
      });
    });

    await page.goto("/korpa", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("npr. SPRING-10").fill(fixture.uiCode.toLowerCase());
    await page.getByRole("button", { name: "Primeni" }).click();
    await expect(page.getByText(`Kod „${fixture.uiCode}” je primenjen`)).toBeVisible();
    await expect(page.getByText(`Vaučer „${fixture.uiCode}”`)).toBeVisible();

    await page
      .locator('aside[aria-label="Sažetak narudžbine"]')
      .getByRole("link", { name: "Nastavi ka podacima za isporuku" })
      .click();
    await expect(page).toHaveURL(/\/checkout\/podaci$/, { timeout: 30_000 });
    await expect(checkoutVoucherTerm(page, fixture.uiCode)).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(checkoutVoucherTerm(page, fixture.uiCode)).toBeVisible();

    await page.getByRole("button", { name: "Nastavi kao gost" }).click();
    await page.getByRole("button", { name: "Nastavi", exact: true }).click();
    await page.getByRole("textbox", { name: "Ime*", exact: true }).fill("QA");
    await page.getByRole("textbox", { name: "Prezime*", exact: true }).fill("Voucher");
    await page
      .getByRole("textbox", { name: "E-pošta*", exact: true })
      .fill(`qa.voucher.ui.${runId}@example.invalid`);
    await page
      .getByRole("textbox", { name: "Telefon*", exact: true })
      .fill("0601234567");
    await page
      .getByRole("combobox", { name: "Grad / mesto*", exact: true })
      .fill("Beograd");
    await page.getByRole("option", { name: /Beograd/ }).first().getByRole("button").click();
    await page
      .getByRole("combobox", { name: "Adresa*", exact: true })
      .fill("Test ulica 1");
    await page
      .getByRole("textbox", { name: "Poštanski broj*", exact: true })
      .fill("11000");
    await page.getByRole("button", { name: "Nastavi", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pregled i potvrda" })).toBeVisible();
    await expect(checkoutVoucherTerm(page, fixture.uiCode)).toBeVisible();
    await page
      .getByTestId("desktop-checkout-consent")
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "Potvrdi porudžbinu" }).click();
    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload).toMatchObject({ voucherCode: fixture.uiCode });
  });

  test("real checkout records the discount and serializes a limit-one voucher", async ({
    request,
  }) => {
    const [left, right] = await Promise.all([
      request.post("/api/checkout/order", {
        data: checkoutPayload(`qa-voucher-race-left-${compactRunId}`),
      }),
      request.post("/api/checkout/order", {
        data: checkoutPayload(`qa-voucher-race-right-${compactRunId}`),
      }),
    ]);
    const responses = await Promise.all([
      responseSummary(left),
      responseSummary(right),
    ]);
    expect(
      responses.map(({ status }) => status).sort((a, b) => a - b),
      JSON.stringify(responses),
    ).toEqual([201, 422]);

    const winning = responses.find(({ status }) => status === 201);
    expect(winning?.body).toMatchObject({
      ok: true,
      data: { subtotal: 1_000, voucherDiscount: 150 },
    });
    const orders = await db.order.findMany({
      where: { voucherCode: fixture.checkoutCode },
      select: { voucherCode: true, voucherDiscount: true, total: true },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.voucherCode).toBe(fixture.checkoutCode);
    expect(Number(orders[0]?.voucherDiscount)).toBe(150);
    expect(await db.voucherRedemption.count({
      where: { voucherCode: fixture.checkoutCode },
    })).toBe(1);
  });

  async function loginAdmin(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 90_000 });
  }

  async function createBareOrder({
    status,
    userId: orderUserId,
    voucherCode,
  }: {
    status: "KREIRANO" | "OTKAZANO";
    userId: string | null;
    voucherCode: string;
  }) {
    bareOrderSequence += 1;
    return db.order.create({
      data: {
        number: `QA-VOUCHER-${runId}-${bareOrderSequence}`,
        userId: orderUserId,
        guestEmail: orderUserId ? null : `qa.bare.${bareOrderSequence}@example.invalid`,
        status,
        subtotal: 1_000,
        voucherCode,
        voucherDiscount: 100,
        total: 900,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Voucher",
        shipPhone: "0601234567",
        shipStreet: "Test ulica 1",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        termsAcceptedAt: new Date(),
      },
      select: { id: true },
    });
  }

  function checkoutPayload(checkoutSessionId: string) {
    return {
      checkoutSessionId,
      guestEmail: `qa.checkout.${checkoutSessionId}@example.invalid`,
      lines: [{ sku: fixture.sku, qty: 1 }],
      shipping: {
        firstName: "QA",
        lastName: "Voucher",
        phone: "0601234567",
        street: "Test ulica 1",
        city: "Beograd",
        postalCode: "11000",
        xExpressTownId: fixture.townId,
        country: "RS",
      },
      billingSameAsShipping: true,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      voucherCode: fixture.checkoutCode,
      consent: true,
    };
  }
});

async function expectVoucher(
  request: APIRequestContext,
  code: string,
  subtotal: number,
  expected: Record<string, unknown>,
) {
  const response = await request.post("/api/voucher/validate", {
    data: { code, subtotal },
  });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  const reason = expected.reason;
  if (reason instanceof RegExp) {
    expect(body).toMatchObject({ ...expected, reason: expect.stringMatching(reason) });
  } else {
    expect(body).toMatchObject(expected);
  }
}

async function installCheckoutRouteMocks(page: Page) {
  await page.route("**/api/analytics/events", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/checkout/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/products/lookup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"products":[]}',
    }),
  );
  await page.route("**/api/checkout/delivery-quote", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          prices: { kurir: 990, kamion: null },
          assemblyPrice: 0,
          assemblyPricesBySku: {},
          recommendedMethod: "kurir",
          pricingIssue: null,
          deliveryCategoriesBySku: {},
          deliveryCategoryBreakdown: null,
          truckAvailable: false,
          truckCities: [],
        },
      }),
    }),
  );
  await page.route("**/api/x-express/locations**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            code: "11000",
            name: "Beograd",
            postalCode: "11000",
            townId: 990_001,
            displayName: "Beograd - 11000",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/x-express/streets**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' }),
  );
}

async function responseSummary(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  return { status: response.status(), body: await response.json() };
}

function checkoutVoucherTerm(page: Page, code: string) {
  return page.locator("dt:visible").filter({ hasText: `Vaučer „${code}”` }).first();
}

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url.toString(),
        max: 2,
        connectionTimeoutMillis: 15_000,
      },
      { schema },
    ),
    log: ["error"],
  });
}
