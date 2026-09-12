import { test, expect } from "@playwright/test";
import { getProductArAsset } from "../../src/lib/product-ar";

test.setTimeout(90000);
const productPath = "/p/100010-6b45ec";
test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");

test.beforeEach(async ({ page }) => {
  // These exercise explicit, on-demand loading. Eligible idle warmup has its own suite.
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true, effectiveType: "4g" } }));
  await page.goto(productPath, { waitUntil: "domcontentloaded" });
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
});

async function loaded(page: import("@playwright/test").Page) {
  await expect(page.locator("model-viewer")).toHaveCount(1, { timeout: 45000 });
  await expect.poll(() => page.locator("model-viewer").evaluate((el) => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45000 }).toBe(true);
}

test("photo loads first; 3D loads only on request and keeps textures, rotation, and accessible QR", async ({ page, isMobile }) => {
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toBeVisible();
  await expect(page.locator("model-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  expect(await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /\.(glb|usdz)([?#]|$)/.test(r.name)).length)).toBe(0);
  if (!isMobile) await expect(page.getByRole("tab", { name: "Slika 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await loaded(page);
  const viewer = page.locator("model-viewer");
  await expect(viewer).toHaveAttribute("ios-src", /cube-v5\.usdz$/);
  await expect(viewer).toHaveAttribute("ar-scale", "fixed");
  await expect.poll(() => viewer.evaluate((el) => {
    const model = (el as unknown as { model: { materials: Array<{ pbrMetallicRoughness: { baseColorTexture: { texture: unknown } } }> } }).model;
    return !!model.materials[0].pbrMetallicRoughness.baseColorTexture.texture;
  })).toBe(true);
  if (!isMobile) {
    const orbit = () => viewer.evaluate(el => (el as unknown as { getCameraOrbit(): { theta: number } }).getCameraOrbit().theta);
    const before = await orbit();
    const box = (await viewer.boundingBox())!;
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .4, { steps: 15 });
    await page.mouse.up();
    await expect.poll(orbit).not.toBe(before);
    await expect(page.getByRole("tab", { name: "3D pregled", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("svg[role=img]")).toBeVisible();
    await expect(dialog.locator("a")).toHaveAttribute("href", new URL("/ar/100010-6b45ec", /localhost|127\.0\.0\.1/.test(new URL(page.url()).hostname) ? process.env.NEXT_PUBLIC_AR_PREVIEW_ORIGIN || page.url() : page.url()).toString());
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true })).toBeFocused();
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
  await page.route("**/cube-210030/*.glb", route => route.abort());
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await expect(page.getByRole("button", { name: "Pokušaj ponovo", exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.locator("[data-product-ar-viewer] > img")).toBeVisible();
  await page.unroute("**/cube-210030/*.glb");
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
  page.on("request", request => { if (request.url().endsWith("cube-v5.glb")) modelRequests.push(request.url()); });
  try {
    await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
    await expect.poll(() => modelRequests.length).toBe(1);
    expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  } finally { releaseRuntime(); }
  await loaded(page);
  expect(modelRequests).toHaveLength(1);
});

test("runtime download failure can be retried", async ({ page }) => {
  await page.route("**/vendor/model-viewer/4.2.0/model-viewer.min.js*", route => route.abort());
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await expect(page.getByRole("button", { name: "Pokušaj ponovo", exact: true })).toBeVisible();
  await page.unroute("**/vendor/model-viewer/4.2.0/model-viewer.min.js*");
  await page.getByRole("button", { name: "Pokušaj ponovo", exact: true }).click();
  await loaded(page);
});

test("gray variant has no local AR model", async ({ page }) => {
  await page.goto("/p/100010-ec1aa0", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("model-viewer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true })).toHaveCount(0);
});

test("mobile QR arrival calls AR from the user click, and unsupported AR explains fallback", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile launch contract");
  await page.goto(productPath + "?ar=1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await loaded(page);
  await expect(page.getByText("Dodirnite dugme da postavite fotelju u sobu.")).toBeVisible();
  // Stub only the device's native AR API; desktop emulation cannot start a real AR session.
  await page.locator("model-viewer").evaluate(el => {
    Object.defineProperty(el, "canActivateAR", { configurable: true, get: () => true });
    (el as unknown as { activateAR: () => Promise<void> }).activateAR = () => { el.setAttribute("data-test-ar-clicked", "yes"); return Promise.resolve(); };
  });
  await page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true }).click();
  await expect(page.locator("model-viewer")).toHaveAttribute("data-test-ar-clicked", "yes");
  await page.locator("model-viewer").evaluate(el => Object.defineProperty(el, "canActivateAR", { configurable: true, get: () => false }));
  await page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true }).click();
  await expect(page.getByText(/Ovaj pregledač ne podržava AR/)).toBeVisible();
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
    await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
    await loaded(page);
    await page.locator("model-viewer").evaluate(el => {
      Object.defineProperty(el, "canActivateAR", { configurable: true, get: () => true });
      (el as unknown as { activateAR: () => Promise<void> }).activateAR = () => {
        el.setAttribute("data-test-ios-launch", el.getAttribute("ios-src") || "missing");
        return Promise.resolve();
      };
    });
    await page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true }).click();
    await expect(page.locator("model-viewer")).toHaveAttribute("data-test-ios-launch", getProductArAsset("100010-6b45ec")!.usdzUrl);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally { await context.close(); }
});


test("full screen contains one viewer and prevents rotation underneath the model", async ({ page }) => {
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await loaded(page);
  await page.getByRole("button", { name: "Prikaži 3D preko celog ekrana" }).click();
  const dialog = page.getByRole("dialog", { name: "3D prikaz preko celog ekrana" });
  await expect(dialog).toBeVisible();
  await loaded(page);
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 2);
  expect(box.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
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
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toBeVisible();
  if (isMobile) await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function() { document.documentElement.dataset.photoArHref = this.href; };
  });
  await page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true }).click();
  if (isMobile) {
    await expect(page.locator("html")).toHaveAttribute("data-photo-ar-href", /intent:.*mode=ar_only/);
  } else {
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("svg[role=img]")).toBeVisible();
    await expect(dialog.locator("a")).toHaveAttribute("href", /\/ar\/100010-6b45ec$/);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true })).toBeFocused();
  }
  await expect(page.locator("model-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  expect(await page.evaluate(() => performance.getEntriesByType("resource").filter(r => /\.(glb|usdz)([?#]|$)/.test(r.name)).length)).toBe(0);
});
