import { test, expect } from "@playwright/test";

test.setTimeout(90000);
test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");
const path = "/p/100010-6b45ec";
async function visit(page: import("@playwright/test").Page) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: false, effectiveType: "4g" } });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
  });
});

test("photo finishes first; prepared model opens without another model transfer", async ({ page }) => {
  let releasePhoto!: () => void;
  const gate = new Promise<void>(resolve => { releasePhoto = resolve; });
  await page.route("**/models/cube-210030/original.webp", async route => { await gate; await route.continue(); });
  let requests = 0;
  page.on("request", req => { if (req.url().endsWith("cube-v5.glb")) requests++; });
  await visit(page);
  try {
    await page.waitForTimeout(1400); // Longer than the warmup delay, with the hero still blocked.
    expect(requests).toBe(0);
    expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
  } finally { releasePhoto(); }
  await expect(page.locator("[data-ar-warm-ready]")).toHaveCount(1, { timeout: 45000 });
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toBeVisible();
  await expect(page.locator("model-viewer")).toHaveCount(0);
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await expect.poll(() => page.locator("model-viewer").evaluate((el) => (el as HTMLElement & { loaded: boolean }).loaded)).toBe(true);
  await expect(page.locator("model-viewer")).toHaveCount(1);
  expect(requests).toBe(1);
});

test("click during preparation never leaves two viewers", async ({ page }) => {
  let releaseRuntime!: () => void;
  const gate = new Promise<void>(resolve => { releaseRuntime = resolve; });
  await page.route("**/vendor/model-viewer/4.2.0/model-viewer.min.js*", async route => { await gate; await route.continue(); });
  await visit(page);
  await expect(page.locator('script[src*="/vendor/model-viewer/"]')).toHaveCount(1, { timeout: 30000 });
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  releaseRuntime();
  await expect.poll(() => page.locator("model-viewer").evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45000 }).toBe(true);
  await expect(page.locator("model-viewer")).toHaveCount(1);
  await expect(page.locator("[data-ar-warmup]")).toHaveCount(0);
});

test("background failure does not poison the user's later attempt", async ({ page }) => {
  let failed = false;
  await page.route("**/cube-210030/*.glb", route => { failed = true; return route.abort(); });
  await visit(page);
  await expect.poll(() => failed, { timeout: 30000 }).toBe(true);
  await expect(page.locator("[data-ar-warmup]")).toHaveCount(0);
  await page.unroute("**/cube-210030/*.glb");
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await expect.poll(() => page.locator("model-viewer").evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45000 }).toBe(true);
});

for (const policy of ["save-data", "slow-connection"]) {
  test(`${policy} keeps loading on demand`, async ({ page }) => {
    await page.addInitScript(policy => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: policy === "save-data", effectiveType: policy === "slow-connection" ? "3g" : "4g" } }), policy);
    await visit(page);
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    await expect(page.locator("model-viewer")).toHaveCount(0);
    expect(await page.evaluate(() => !!customElements.get("model-viewer"))).toBe(false);
    expect(await page.evaluate(() => performance.getEntriesByType("resource").some(x => x.name.endsWith("cube-v5.glb")))).toBe(false);
  });
}


test("AR and 3D buttons wait until their click handlers are ready", async ({ page }) => {
  let releaseScripts!: () => void;
  const gate = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route("**/_next/static/**/*.js*", async route => { await gate; await route.continue(); });
  await page.goto(path, { waitUntil: "commit" });
  const view3d = page.getByRole("button", { name: "Otvori 3D pregled" });
  const ar = page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true });
  try {
    await expect(view3d).toBeVisible();
    await expect(view3d).toBeDisabled();
    await expect(ar).toBeDisabled();
  } finally { releaseScripts(); }
  await expect(view3d).toBeEnabled();
  await expect(ar).toBeEnabled();
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
  await view3d.click();
  await expect.poll(() => page.locator("model-viewer").evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45000 }).toBe(true);
});
