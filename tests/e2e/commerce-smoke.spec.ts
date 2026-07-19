import { expect, test } from "@playwright/test";

test.skip(
  process.env.E2E_LIVE_CATALOG !== "1",
  "Live-catalog smoke requires E2E_LIVE_CATALOG=1 and a configured read-only catalog database.",
);

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{
    name: "spc_cookie_consent",
    value: "essential",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  }]);
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

test("the launch SKU can move from search to cart and checkout entry", async ({ page }) => {
  await page.goto("/pretraga?q=RELAX", { waitUntil: "domcontentloaded" });
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: "RELAX", exact: true }),
  });
  await expect(card).toBeVisible();
  const add = card.getByRole("button", { name: "Dodaj u korpu" });
  await expect(add).toBeEnabled();

  await add.click();
  await expect(card.getByRole("button", { name: "Povećaj količinu" })).toBeVisible();

  await page.goto("/korpa", { waitUntil: "domcontentloaded" });
  const cartItems = page.getByRole("region", { name: "Stavke u korpi" });
  await expect(cartItems).toContainText("RELAX");
  await expect(page.getByRole("complementary", { name: "Sažetak narudžbine" })).toBeVisible();

  await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Kako želite da nastavite?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nastavi", exact: true }),
  ).toBeEnabled();
});
