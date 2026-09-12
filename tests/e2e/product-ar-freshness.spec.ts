import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");
test.setTimeout(90_000);

test("an open gallery refreshes its model after returning to the tab", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  });
  let revision = 0;
  let checks = 0;
  await page.route("**/api/product-ar/100010-9ce68e", async route => {
    const response = await route.fetch();
    const asset = await response.json();
    checks++;
    if (revision === 2) {
      await route.fulfill({ status: 404, json: null });
      return;
    }
    if (revision) asset.glbUrl += "#freshness-test";
    await route.fulfill({ response, json: asset });
  });
  await page.goto("/p/100010-9ce68e", { waitUntil: "domcontentloaded" });
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect.poll(() => checks).toBe(1);
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  const viewer = page.locator("model-viewer");
  await expect.poll(() => viewer.evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45_000 }).toBe(true);
  revision = 1;
  // Advance only the freshness clock, without slowing the test for 30 seconds.
  await page.evaluate(() => {
    const now = Date.now;
    Date.now = () => now() + 31_000;
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => viewer.evaluate(el => (el as HTMLElement & { src: string }).src)).toMatch(/#freshness-test$/);
  await expect(page.locator("model-viewer")).toHaveCount(1);
  await expect.poll(() => viewer.evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45_000 }).toBe(true);
  expect(checks).toBe(2);
  revision = 2;
  await page.evaluate(() => {
    const now = Date.now;
    Date.now = () => now() + 31_000;
    window.dispatchEvent(new Event("focus"));
  });
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true })).toHaveCount(0);
});
