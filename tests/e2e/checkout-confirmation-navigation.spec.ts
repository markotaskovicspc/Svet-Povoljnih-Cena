import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const runId = `${Date.now()}-${process.pid}`;
const orderNumber = `SPC-QA-NAV-${runId}`;
const accessToken = `qa-navigation-token-${runId}`;
let db: PrismaClient;

test.skip(
  process.env.E2E_CHECKOUT_NAVIGATION !== "1",
  "Checkout confirmation navigation runs only in the isolated acceptance flow.",
);
test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required for checkout navigation acceptance.",
    );
  }
  db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 15_000,
    }),
  });
  await db.order.deleteMany({ where: { number: orderNumber } });
  await db.order.create({
    data: {
      number: orderNumber,
      publicAccessTokenHash: createHash("sha256")
        .update(accessToken, "utf8")
        .digest("base64url"),
      publicAccessTokenCreatedAt: new Date(),
      guestEmail: "delivered@resend.dev",
      subtotal: 100,
      shipping: 990,
      total: 1_090,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      shipFirstName: "Codex",
      shipLastName: "QA",
      shipPhone: "0601234567",
      shipStreet: "Kralja Petra I 1",
      shipCity: "Kragujevac",
      shipPostalCode: "34000",
      termsAcceptedAt: new Date(),
      items: {
        create: {
          sku: "QA-NAVIGATION",
          name: "QA checkout navigation",
          qty: 1,
          unitPriceFull: 100,
          unitPriceSale: 100,
        },
      },
    },
  });
});

test.afterAll(async () => {
  if (!db) return;
  try {
    await db.order.deleteMany({ where: { number: orderNumber } });
  } finally {
    await db.$disconnect();
  }
});

test("successful guest order lands on the confirmation route", async ({
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
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "spc-cart",
      JSON.stringify({
        state: {
          lines: [
            {
              sku: "QA-NAVIGATION",
              name: "QA checkout navigation",
              slug: "qa-checkout-navigation",
              qty: 1,
              unitPriceFull: 100,
              unitPriceSale: 100,
            },
          ],
        },
        version: 0,
      }),
    );
  });

  await page.route("**/api/analytics/events", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/checkout/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    }),
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
          prices: { kurir: 990, kamion: 4990 },
          assemblyPrice: 2990,
          assemblyPricesBySku: {},
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
            code: "34000",
            name: "Kragujevac",
            postalCode: "34000",
            townId: 718980,
            municipalityId: 1,
            displayName: "Kragujevac (Kragujevac)",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/x-express/streets**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: 18955,
            streetId: 18955,
            name: "Kralja Petra I 1",
            official: true,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/checkout/order", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id: "qa-navigation-order-id",
          number: orderNumber,
          accessToken,
          total: 1090,
          paymentMethod: "POUZECE_GOTOVINA",
          shippingMethod: "KURIR",
        },
      }),
    }),
  );

  await page.goto("/checkout/podaci", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Nastavi kao gost" }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "Nastavi", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeLessThanOrEqual(8);
  await expect(
    page.getByRole("heading", { name: "Isporuka i plaćanje" }),
  ).toBeVisible();
  await expect(page.getByTestId("mobile-checkout-navigation")).toHaveCSS(
    "position",
    "fixed",
  );
  await expect(
    page.getByRole("radio", { name: /Pouzeće — gotovina/ }),
  ).toBeChecked();

  await page.getByRole("textbox", { name: "Ime*", exact: true }).fill("Codex");
  await page.getByRole("textbox", { name: "Prezime*", exact: true }).fill("QA");
  await page
    .getByRole("textbox", { name: "E-pošta*", exact: true })
    .fill("delivered@resend.dev");
  await page
    .getByRole("textbox", { name: "Telefon*", exact: true })
    .fill("0601234567");
  await page
    .getByRole("combobox", { name: "Grad / mesto*", exact: true })
    .fill("Kragujevac");
  await page
    .getByRole("option", { name: /Kragujevac/ })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Adresa*", exact: true })
    .fill("Kralja Petra");
  const streetOption = page.getByRole("option", { name: /Kralja Petra I 1/ });
  if (await streetOption.isVisible().catch(() => false))
    await streetOption.click();
  await page
    .getByRole("textbox", { name: "Poštanski broj*", exact: true })
    .fill("34000");
  const [firstNameBox, lastNameBox, cityBox, postalCodeBox] = await Promise.all(
    [
      page.getByRole("textbox", { name: "Ime*", exact: true }).boundingBox(),
      page
        .getByRole("textbox", { name: "Prezime*", exact: true })
        .boundingBox(),
      page
        .getByRole("combobox", { name: "Grad / mesto*", exact: true })
        .boundingBox(),
      page
        .getByRole("textbox", { name: "Poštanski broj*", exact: true })
        .boundingBox(),
    ],
  );
  expect(firstNameBox?.y).toBeCloseTo(lastNameBox?.y ?? -100, 0);
  expect(cityBox?.y).toBeCloseTo(postalCodeBox?.y ?? -100, 0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "Nastavi", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeLessThanOrEqual(8);
  await expect(
    page.getByRole("heading", { name: "Pregled i potvrda" }),
  ).toBeVisible();
  const [deliveryBlock, methodBlock] = await Promise.all([
    page.locator('[data-review-block="Isporuka"]').boundingBox(),
    page.locator('[data-review-block="Način isporuke"]').boundingBox(),
  ]);
  expect(deliveryBlock?.y).toBeCloseTo(methodBlock?.y ?? -100, 0);
  await page.getByLabel(/Saglasan\/a sam/).check();
  await page.getByRole("button", { name: "Potvrdi porudžbinu" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/checkout/potvrda\\?order=${orderNumber}`),
  );
  await expect(
    page.getByRole("heading", { name: "Hvala vam na porudžbini!" }).first(),
  ).toBeVisible();
});
