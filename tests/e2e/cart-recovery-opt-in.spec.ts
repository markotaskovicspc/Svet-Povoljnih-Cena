import { expect, test } from "@playwright/test";

test.skip(
  process.env.E2E_CART_RECOVERY_UI !== "1",
  "Cart recovery UI smoke runs only in its isolated local flow.",
);

test("checkout captures explicit cart-recovery consent and can revoke it", async ({
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
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "spc-cart",
      JSON.stringify({
        state: {
          lines: [
            {
              sku: "ERGO-LUX",
              name: "Ergo Lux stolica",
              slug: "ergo-lux-stolica",
              qty: 1,
              unitPriceFull: 2856,
              unitPriceSale: 2001,
              deliveryCategory: 1,
            },
          ],
        },
        version: 0,
      }),
    );
  });

  const captured: Array<Record<string, unknown>> = [];
  await page.route("**/api/analytics/events", (route) =>
    route.fulfill({ status: 204 }),
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
          prices: { kurir: 0, kamion: null },
          recommendedMethod: "kurir",
          pricingIssue: null,
          deliveryCategoriesBySku: { "ERGO-LUX": 1 },
          deliveryCategoryBreakdown: null,
          assemblyPrice: 0,
          assemblyPricesBySku: {},
          truckAvailable: false,
          truckCities: [],
        },
      }),
    }),
  );
  await page.route("**/api/checkout/session", async (route) => {
    captured.push(
      (await route.request().postDataJSON()) as Record<string, unknown>,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });

  await page.goto("/checkout/podaci", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Nastavi kao gost" }).click();
  await page.getByRole("button", { name: "Nastavi", exact: true }).click();

  const recoveryConsent = page.getByRole("checkbox", {
    name: /najviše tri podsetnika ako ne završim kupovinu/i,
  });
  await expect(recoveryConsent).toBeVisible();
  await expect(recoveryConsent).not.toBeChecked();

  await page
    .getByRole("textbox", { name: "E-pošta*", exact: true })
    .fill("kupac@example.com");
  await recoveryConsent.check();

  await expect
    .poll(() =>
      captured.some(
        (payload) =>
          payload.recoveryConsent === true &&
          payload.guestEmail === "kupac@example.com" &&
          Array.isArray(payload.lines) &&
          payload.lines.length === 1,
      ),
    )
    .toBe(true);

  await recoveryConsent.uncheck();
  await expect
    .poll(() => captured.some((payload) => payload.recoveryConsent === false))
    .toBe(true);
});
