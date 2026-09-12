import { test, expect } from "@playwright/test";
import { getProductArAsset } from "../../src/lib/product-ar";

test.setTimeout(90000);
const productPath = "/p/100010-9ce68e";
test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");

test.beforeEach(async ({ page }) => {
  // These exercise explicit, on-demand loading. Eligible idle warmup has its own suite.
  await page.addInitScript(() => localStorage.setItem("svet-akcija:first-purchase-cta-closed-until", String(Date.now() + 86400000)));
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true, effectiveType: "4g" } }));
  await page.goto(productPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" })).toBeEnabled();
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
});

async function loaded(page: import("@playwright/test").Page) {
  await expect(page.locator("model-viewer")).toHaveCount(1, { timeout: 45000 });
  await expect.poll(() => page.locator("model-viewer").evaluate((el) => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45000 }).toBe(true);
}

test("photo loads first; 3D loads only on request and keeps textures, rotation, and accessible QR", async ({ page, isMobile }) => {
  await expect(page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" })).toBeVisible();
  await expect(page.locator("model-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  expect(await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /\.(glb|usdz)([?#]|$)/.test(r.name)).length)).toBe(0);
  if (!isMobile) await expect(page.getByRole("tab", { name: "Slika 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
  await loaded(page);
  const viewer = page.locator("model-viewer");
  await expect(viewer).not.toHaveAttribute("ar");
  await expect.poll(() => viewer.evaluate((el) => {
    const model = (el as unknown as { model: { materials: Array<{ pbrMetallicRoughness: { baseColorTexture: { texture: unknown } } }> } }).model;
    return model.materials.some(material => !!material.pbrMetallicRoughness.baseColorTexture?.texture);
  })).toBe(true);
  if (!isMobile) {
    const orbit = () => viewer.evaluate(el => (el as unknown as { getCameraOrbit(): { theta: number } }).getCameraOrbit().theta);
    const before = await orbit();
    await viewer.scrollIntoViewIfNeeded();
    const box = (await viewer.boundingBox())!;
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .4, { steps: 15 });
    await page.mouse.up();
    await expect.poll(orbit).not.toBe(before);
    await expect(page.getByRole("tab", { name: "3D pregled", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("svg[role=img]")).toBeVisible();
    await expect(dialog.locator("a")).toHaveAttribute("href", new URL("/ar/100010-9ce68e?ar_entry=qr", /localhost|127\.0\.0\.1/.test(new URL(page.url()).hostname) ? process.env.NEXT_PUBLIC_AR_PREVIEW_ORIGIN || page.url() : page.url()).toString());
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ })).toBeFocused();
    await page.getByRole("button", { name: "Sledeća slika", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Prikaži sliku 2", exact: true }).filter({ visible: true }).click();
  }
  await expect(page.locator("model-viewer")).toHaveCount(0);
  await page.getByRole("button", { name: "Prikaži 3D model", exact: true }).filter({ visible: true }).click();
  await loaded(page);
});

test("failed model offers photo fallback and retry", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/x-desk-210027/*.glb", route => route.abort());
  await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
  await expect(page.getByRole("button", { name: "Pokušaj ponovo", exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.locator("[data-product-ar-viewer] > img")).toBeVisible();
  await page.unroute("**/x-desk-210027/*.glb");
  await page.getByRole("button", { name: "Pokušaj ponovo", exact: true }).click();
  await loaded(page);
});

test("3D activation downloads the model while the runtime loads, with one model transfer", async ({ page }) => {
  let releaseRuntime!: () => void;
  const gate = new Promise<void>(resolve => { releaseRuntime = resolve; });
  await page.route("**/vendor/model-viewer/4.2.0/model-viewer.min.js*", async route => {
    await gate;
    await route.continue();
  });
  const modelRequests: string[] = [];
  page.on("request", request => { if (request.url().endsWith("x-desk-v3.glb")) modelRequests.push(request.url()); });
  try {
    await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
    await expect.poll(() => modelRequests.length).toBe(1);
    expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  } finally { releaseRuntime(); }
  await loaded(page);
  expect(modelRequests).toHaveLength(1);
});

test("runtime download failure can be retried", async ({ page }) => {
  await page.route("**/vendor/model-viewer/4.2.0/model-viewer.min.js*", route => route.abort());
  await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
  await expect(page.getByRole("button", { name: "Pokušaj ponovo", exact: true })).toBeVisible();
  await page.unroute("**/vendor/model-viewer/4.2.0/model-viewer.min.js*");
  await page.getByRole("button", { name: "Pokušaj ponovo", exact: true }).click();
  await loaded(page);
});

test("gray variant has no local AR model", async ({ page }) => {
  await page.goto("/p/100010-ec1aa0", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("model-viewer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ })).toHaveCount(0);
});

test("Android viewer launches AR-only without the library's native 3D fallback", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Android launch contract");
  await page.goto(productPath + "?ar=1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
  await loaded(page);
  await expect(page.locator("[data-product-ar-entry]")).toBeVisible();
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.href.startsWith("intent:")) { document.documentElement.dataset.viewerArHref = this.href; return; }
      click.call(this);
    };
  });
  await page.locator("model-viewer").evaluate(el => {
    (el as unknown as { activateAR: () => Promise<void> }).activateAR = () => { throw new Error("Must not use ar_preferred"); };
  });
  await page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ }).click();
  const href = await page.locator("html").getAttribute("data-viewer-ar-href");
  expect(href).toContain("mode=ar_only");
  expect(href).toContain("package=com.google.ar.core;");
  expect(href).toContain(encodeURIComponent(new URL("/ar/100010-9ce68e?manual=1&arFallback=1", page.url()).href));
  expect(href).not.toContain("googlequicksearchbox");
});

test("iPhone launch keeps the dedicated USDZ asset", async ({ browser, isMobile, baseURL }) => {
  test.skip(!isMobile, "One iPhone emulation is sufficient");
  const context = await browser.newContext({
    baseURL,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(productPath + "?ar=1", { waitUntil: "domcontentloaded" });
    const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
    if (await consent.isVisible()) await consent.click();
    await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
    await loaded(page);
    await page.evaluate(() => {
      const supports = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function(token) { return token === "ar" || supports.call(this, token); };
      HTMLAnchorElement.prototype.click = function() { document.documentElement.dataset.iosLaunch = this.href; };
    });
    await page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-ios-launch", getProductArAsset("100010-9ce68e")!.usdzUrl + "#allowsContentScaling=0");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally { await context.close(); }
});


test("full screen contains one viewer and prevents rotation underneath the model", async ({ page }) => {
  await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
  await loaded(page);
  await page.getByRole("button", { name: "Prikaži 3D preko celog ekrana" }).click();
  const dialog = page.getByRole("dialog", { name: "3D prikaz preko celog ekrana" });
  await expect(dialog).toBeVisible();
  await loaded(page);
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 2);
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
  const viewer = page.locator("model-viewer");
  await expect(viewer).toHaveAttribute("disable-pan", "");
  await viewer.evaluate(el => {
    const model = el as unknown as { cameraOrbit: string; jumpCameraToGoal: () => void };
    model.cameraOrbit = "35deg 170deg auto";
  });
  await expect.poll(() => viewer.evaluate(el => (el as unknown as { getCameraOrbit(): { phi: number } }).getCameraOrbit().phi)).toBeCloseTo(85 * Math.PI / 180, 2);
  await page.getByRole("button", { name: "Zatvori prikaz preko celog ekrana" }).click();
  await expect(dialog).not.toBeVisible();
  await loaded(page);
  await expect(page.getByRole("button", { name: "Prikaži 3D preko celog ekrana" })).toBeFocused();
  await expect(viewer).toHaveAttribute("max-camera-orbit", "auto 85deg auto");
});


test("photo AR button opens QR or native AR without downloading the web model", async ({ page, isMobile }) => {
  await expect(page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" })).toBeVisible();
  if (isMobile) await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function() { document.documentElement.dataset.photoArHref = this.href; };
  });
  await page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ }).click();
  if (isMobile) {
    await expect(page.locator("html")).toHaveAttribute("data-photo-ar-href", /intent:.*mode=ar_only/);
  } else {
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("svg[role=img]")).toBeVisible();
    await expect(dialog.locator("a")).toHaveAttribute("href", /\/ar\/100010-9ce68e\?ar_entry=qr$/);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^(Vidi u svojoj sobi|Proveri kako se uklapa)$/ })).toBeFocused();
  }
  await expect(page.locator("model-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  expect(await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /\.(glb|usdz)([?#]|$)/.test(r.name)).length)).toBe(0);
});
