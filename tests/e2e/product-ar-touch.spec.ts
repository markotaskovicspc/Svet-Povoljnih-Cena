import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");
test.setTimeout(90_000);

async function openModel(page: Page) {
  // Keep the unrelated timed signup popup from covering the gesture coordinates.
  await page.addInitScript(() => localStorage.setItem("svet-akcija:first-purchase-cta-closed-until", String(Date.now() + 86_400_000)));
  await page.goto("/p/100010-9ce68e", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Otvori 3D pregled" })).toBeEnabled();
  const consent = page.getByRole("button", { name: "Samo nužni", exact: true });
  if (await consent.isVisible()) await consent.click();
  await page.getByRole("button", { name: "Otvori 3D pregled" }).click();
  await expect.poll(() => page.locator("model-viewer").evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45_000 }).toBe(true);
  await page.locator("model-viewer").scrollIntoViewIfNeeded();
}

async function drag(page: Page, touch: boolean, x: number, y: number, dx: number, dy = 0) {
  if (!touch) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 12, y: y + dy * step / 12 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
}

test("rotation works under labels, beside controls, and along the bottom without moving the gallery", async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch injection uses Chromium CDP");
  await openModel(page);
  const viewer = page.locator("model-viewer");
  const orbit = () => viewer.evaluate(el => (el as unknown as { getCameraOrbit(): { theta: number } }).getCameraOrbit().theta);
  for (const expanded of [false, true]) {
    if (expanded) {
      await page.getByRole("button", { name: "Prikaži 3D preko celog ekrana" }).click();
      await expect.poll(() => viewer.evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded)).toBe(true);
    }
    for (const [fx, fy] of [[.06, .08], [.92, .7], [.92, .86], [.06, .76], [.06, .95]]) {
      const box = (await viewer.boundingBox())!;
      const x = box.x + box.width * fx, y = box.y + box.height * fy;
      const hit = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return { model: !!el?.closest("model-viewer"), html: el?.outerHTML.slice(0, 400) }; }, { x, y });
      expect(hit.model, `Touch at ${fx}, ${fy}: ${hit.html}`).toBe(true);
      const galleryOffset = () => viewer.evaluate(el => el.closest('[aria-roledescription="carousel"]')?.scrollLeft ?? 0);
      const initialOffset = await galleryOffset();
      const before = await orbit();
      await drag(page, isMobile, x, y, fx > .5 ? -65 : 65);
      await expect.poll(async () => Math.abs((await orbit()) - before)).toBeGreaterThan(.02);
      await expect(viewer).toHaveCount(1);
      expect(await galleryOffset()).toBeCloseTo(initialOffset, 0);
    }
  }
});

test("vertical phone scroll works when starting over the badge and beside the AR controls", async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile || browserName !== "chromium", "Mobile native scrolling");
  await openModel(page);
  for (const [fx, fy] of [[.06, .08], [.92, .7]]) {
    await page.locator("[data-product-ar-viewer]").evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 180));
    const box = (await page.locator("model-viewer").boundingBox())!;
    const before = await page.evaluate(() => window.scrollY);
    await drag(page, true, box.x + box.width * fx, box.y + box.height * fy, 0, -90);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 25);
    await expect(page.locator("model-viewer")).toHaveCount(1);
  }
});
