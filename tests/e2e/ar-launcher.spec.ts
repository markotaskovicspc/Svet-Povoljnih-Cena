import { test, expect } from "@playwright/test";

test("QR destination launches native AR once, with a manual fallback that does not loop", async ({ browser, baseURL }) => {
  for (const platform of ["ios", "android"]) {
    const context = await browser.newContext({ baseURL, userAgent: platform === "ios"
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      const supports = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function(token) { return token === "ar" || supports.call(this, token); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (this.rel === "ar" || this.href.startsWith("intent:")) {
          document.documentElement.dataset.nativeAr = this.href;
          document.documentElement.dataset.nativeArCount = String(Number(document.documentElement.dataset.nativeArCount || 0) + 1);
          return;
        }
        click.call(this);
      };
    });
    const page = await context.newPage();
    await page.route("**/api/product-ar/count", route => route.fulfill({status:204}));
    try {
      await page.goto("/ar/100010-9ce68e", { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-native-ar-count", "1", { timeout: 30000 });
      const link = page.getByRole("link", { name: "Pokreni AR" });
      const href = (await link.getAttribute("href"))!;
      expect(href).toContain(platform === "ios" ? "x-desk-v3.usdz#allowsContentScaling=0" : "mode=ar_only");
      await expect(page.locator("model-viewer")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Dodaj u korpu" })).toHaveCount(0);
      await page.goto("/ar/100010-9ce68e?manual=1", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: "Pokreni AR" })).toBeVisible();
      await expect(page.locator("html")).not.toHaveAttribute("data-native-ar-count");
    } finally { await context.close(); }
  }
});

test("AR route rejects products without a registered model", async ({ page }) => {
  const response = await page.goto("/ar/100010-ec1aa0", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Pokreni AR" })).toHaveCount(0);
});


test("Android AR failure shows recovery guidance without relaunching or substituting 3D", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36" });
  await context.addInitScript(() => {
    document.addEventListener("click", event => {
      const anchor = (event.target as Element).closest("a");
      if (anchor?.href.startsWith("intent:")) {
        event.preventDefault();
        document.documentElement.dataset.arRetry = anchor.href;
      }
    }, true);
  });
  try {
    const page = await context.newPage();
    await page.route("**/api/product-ar/count", route => route.fulfill({status:204}));
    await page.goto("/ar/100010-9ce68e?manual=1&arFallback=1");
    await expect(page.getByRole("status")).toContainText("AR kamera nije pokrenuta.");
    await expect(page.locator("html")).not.toHaveAttribute("data-ar-retry");
    await expect(page.locator("model-viewer")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Otvori u Chrome-u" })).toHaveAttribute("href", /manual=1#Intent;.*package=com.android.chrome;/);
    await page.getByRole("link", { name: "Pokreni AR", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-ar-retry", /mode=ar_only.*package=com.google.ar.core;/);
  } finally { await context.close(); }
});

// Prevent browser checks from writing aggregate counts to the catalog database.
test.beforeEach(async ({ page }) => { await page.route("**/api/product-ar/count", route => route.fulfill({ status: 204 })); });
