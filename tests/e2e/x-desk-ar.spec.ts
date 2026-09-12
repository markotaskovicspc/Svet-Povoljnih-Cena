import { test, expect } from "@playwright/test";
import { getProductArAsset } from "../../src/lib/product-ar";

test.setTimeout(90000);
test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");
const slug = "100010-9ce68e";
const asset = getProductArAsset(slug)!;

test("CUBE chair has only photos and its old AR links are disabled", async ({ page, request }) => {
  const mediaRequests: string[] = [];
  page.on("request", req => {
    if (/\.(glb|usdz)([?#]|$)|vendor\/model-viewer/.test(req.url())) mediaRequests.push(req.url());
  });
  await page.goto("/p/100010-6b45ec?ar=1", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CUBE");
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true })).toHaveCount(0);
  await expect(page.locator("model-viewer")).toHaveCount(0);
  expect(mediaRequests).toEqual([]);
  const manifest = await request.get("/api/product-ar/100010-6b45ec");
  expect(manifest.status()).toBe(404);
  expect(await manifest.json()).toBeNull();
  expect((await request.get("/ar/100010-6b45ec")).status()).toBe(404);
});

test("X DESK retains its photo first, loads the small textured model, and supports full screen", async ({ page, isMobile }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true, effectiveType: "4g" } }));
  await page.goto(`/p/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toBeEnabled();
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("X DESK");
  await expect(page.locator("model-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /\.(glb|usdz)([?#]|$)/.test(r.name)).length)).toBe(0);
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  const viewer = page.locator("model-viewer");
  await expect(viewer).toHaveCount(1);
  await expect.poll(() => viewer.evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45000 }).toBe(true);
  // React assigns declared custom-element properties directly, without an HTML attribute.
  await expect(viewer).toHaveJSProperty("src", asset.glbUrl);
  await expect(viewer).toHaveAttribute("ios-src", asset.usdzUrl);
  await expect(viewer).toHaveAttribute("ar-scale", "fixed");
  await expect(viewer).toHaveAttribute("max-camera-orbit", "auto 85deg auto");
  const dimensions = await viewer.evaluate(el => (el as unknown as { getDimensions(): { x: number; y: number; z: number } }).getDimensions());
  expect(dimensions.x).toBeCloseTo(.70, 3);
  expect(dimensions.y).toBeCloseTo(.74, 3);
  expect(dimensions.z).toBeCloseTo(.48, 3);
  await expect.poll(() => viewer.evaluate(el => (el as unknown as { model: { materials: { pbrMetallicRoughness: { baseColorTexture: { texture: unknown } } }[] } }).model.materials.some(m => !!m.pbrMetallicRoughness.baseColorTexture?.texture))).toBe(true);
  await page.getByRole("button", { name: "Prikaži 3D preko celog ekrana" }).click();
  await expect(page.getByRole("dialog", { name: "3D prikaz preko celog ekrana" })).toBeVisible();
  await expect(viewer).toHaveCount(1);
  await page.getByRole("button", { name: "Zatvori prikaz preko celog ekrana" }).click();
  if (!isMobile) {
    await page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true }).click();
    await expect(page.getByRole("dialog").locator("a")).toHaveAttribute("href", new RegExp(`/ar/${slug}$`));
  }
});

test("X DESK QR uses its own Android and iPhone assets and dimensions", async ({ browser, baseURL }) => {
  for (const platform of ["android", "ios"]) {
    const context = await browser.newContext({ baseURL, userAgent: platform === "ios"
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      const supports = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function(token) { return token === "ar" || supports.call(this, token); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (this.rel === "ar" || this.href.startsWith("intent:")) { document.documentElement.dataset.nativeAr = this.href; return; }
        click.call(this);
      };
    });
    try {
      const page = await context.newPage();
      await page.goto(`/ar/${slug}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proizvod u vašoj sobi");
      await expect(page.getByText("Stvarna veličina · 70 × 48 × 74 cm")).toBeVisible();
      const href = (await page.getByRole("link", { name: "Pokreni AR" }).getAttribute("href"))!;
      expect(href).toContain(platform === "ios" ? asset.usdzUrl + "#allowsContentScaling=0" : encodeURIComponent(asset.glbUrl));
      if (platform === "android") expect(href).toContain("mode=ar_only");
      await expect(page.locator("html")).toHaveAttribute("data-native-ar", href);
      await expect(page.locator("model-viewer")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Nazad na proizvod i 3D prikaz" })).toHaveAttribute("href", `/p/${slug}`);
    } finally { await context.close(); }
  }
});
