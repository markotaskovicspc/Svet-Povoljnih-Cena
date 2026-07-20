import { expect, test, type Page } from "@playwright/test";
import { getGa4MeasurementId } from "@/lib/analytics/config";

test.skip(
  process.env.E2E_LIVE_CATALOG !== "1",
  "GA4 commerce smoke requires E2E_LIVE_CATALOG=1 and a configured read-only catalog database.",
);

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    {
      name: "spc_cookie_consent",
      value: "analytics",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    },
  ]);
  await page.route("https://www.googletagmanager.com/gtag/js**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );
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
});

test("sends view_item, add_to_cart and begin_checkout to the GA4 data layer", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/pretraga?q=RELAX", { waitUntil: "domcontentloaded" });
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: "RELAX", exact: true }),
  });
  const productHref = await card
    .getByRole("heading", { name: "RELAX", exact: true })
    .getByRole("link", { name: "RELAX", exact: true })
    .getAttribute("href");
  expect(productHref).toMatch(/^\/p\//);
  await page.goto(productHref!, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.locator("#_next-ga")).toHaveAttribute(
    "src",
    `https://www.googletagmanager.com/gtag/js?id=${getGa4MeasurementId()}`,
  );

  const viewItem = await waitForGaEvent(page, "view_item");
  expect(viewItem?.[2]).toEqual(
    expect.objectContaining({
      currency: "RSD",
      items: [
        expect.objectContaining({
          item_id: expect.any(String),
          item_name: "RELAX",
          price: expect.any(Number),
          quantity: 1,
        }),
      ],
    }),
  );

  await page.getByRole("button", { name: "Dodaj u korpu" }).first().click();
  const addToCart = await waitForGaEvent(page, "add_to_cart");
  expect(addToCart?.[2]).toEqual(
    expect.objectContaining({
      currency: "RSD",
      items: [
        expect.objectContaining({
          item_name: "RELAX",
          quantity: 1,
        }),
      ],
    }),
  );

  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  const beginCheckout = await waitForGaEvent(page, "begin_checkout");
  expect(beginCheckout?.[2]).toEqual(
    expect.objectContaining({
      currency: "RSD",
      value: expect.any(Number),
      items: [
        expect.objectContaining({
          item_name: "RELAX",
          quantity: 1,
        }),
      ],
    }),
  );
});

async function waitForGaEvent(page: Page, eventName: string) {
  await expect
    .poll(() => readGaEvent(page, eventName), { timeout: 15_000 })
    .not.toBeNull();
  return readGaEvent(page, eventName);
}

async function readGaEvent(page: Page, eventName: string) {
  return page.evaluate((name) => {
    const dataLayer = (
      window as unknown as {
        dataLayer?: Array<ArrayLike<unknown>>;
      }
    ).dataLayer;
    if (!Array.isArray(dataLayer)) return null;
    return (
      dataLayer
        .map((entry) => Array.from(entry))
        .find(
          (entry) =>
            entry[0] === "event" &&
            entry[1] === name,
        ) ?? null
    );
  }, eventName);
}
