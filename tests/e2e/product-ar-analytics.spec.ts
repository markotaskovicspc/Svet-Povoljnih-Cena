import { test, expect, type Page } from "@playwright/test";
test.skip(process.env.E2E_LIVE_CATALOG !== "1", "Read-only catalog opt-in required");
test.setTimeout(90_000);
const slug = "100010-9ce68e";
type Event = { type: string; metadata?: { event: string; surface: string; variant: string; campaign: string; content: string; source: string } };
async function setup(page: Page, consent: boolean, variant = "B") {
  const events: Event[] = [];
  // Never send test visits into the live analytics database.
  await page.route("**/api/analytics/events", async route => { events.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true }, status: 201 }); });
  await page.addInitScript(({ consent, variant }) => {
    document.cookie = `spc_cookie_consent=${consent ? "analytics" : "essential"}; path=/`;
    document.cookie = "spc_cookie_consent_version=2026-08-meta; path=/";
    localStorage.setItem("svet-akcija:first-purchase-cta-closed-until", String(Date.now() + 86_400_000));
    if (consent) localStorage.setItem("spc:ar-copy-v2", variant);
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true, effectiveType: "4g" } });
  }, { consent, variant });
  return events;
}
const stage = (events: Event[], name: string) => events.filter(e => e.type === "PRODUCT_AR" && e.metadata?.event === name);
async function model(page: Page) {
  await page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" }).click();
  await expect.poll(() => page.locator("model-viewer").evaluate(el => (el as HTMLElement & { loaded: boolean }).loaded), { timeout: 45_000 }).toBe(true);
}
test("separate 3D and AR funnels keep campaign and variant; repeated rotation counts one user event", async ({ page, isMobile }) => {
  const events = await setup(page, true);
  await page.goto(`/p/${slug}?utm_source=facebook&utm_medium=paid_social&utm_campaign=desk&utm_content=video1`);
  const ar = page.getByRole("button", { name: /^(Pogledaj u svojoj sobi|Isprobaj u svojoj sobi)$/ });
  await expect(ar).toHaveText("Isprobaj u svojoj sobi");
  await ar.scrollIntoViewIfNeeded();
  await expect.poll(() => stage(events, "controls_viewed").some(e => e.metadata?.surface === "ar_cta")).toBe(true);
  expect(stage(events, "model_opened")).toHaveLength(0);
  await model(page);
  await expect.poll(() => stage(events, "model_opened").length).toBe(1);
  await page.locator("model-viewer").evaluate(el => {
    el.dispatchEvent(new CustomEvent("camera-change", { detail: { source: "none" } }));
  });
  expect(stage(events, "model_used")).toHaveLength(0);
  // Check the library's documented event contract for repeat user interactions.
  await page.locator("model-viewer").evaluate(el => {
    for (let i = 0; i < 3; i++) el.dispatchEvent(new CustomEvent("camera-change", { detail: { source: "user-interaction" } }));
  });
  await expect.poll(() => stage(events, "model_used").length).toBe(1);
  await page.getByRole("button", { name: "Nazad na fotografije" }).click();
  await expect(page.locator("model-viewer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pogledaj iz svih uglova · 3D" })).toBeVisible();
  if (isMobile) await page.evaluate(() => { HTMLAnchorElement.prototype.click = function() { document.documentElement.dataset.arHref = this.href; }; });
  await ar.click();
  await expect.poll(() => stage(events, "ar_clicked").length).toBe(1);
  if (isMobile) {
    await expect.poll(() => stage(events, "ar_attempted").length).toBe(1);
    await expect(page.locator("html")).toHaveAttribute("data-ar-href", /mode=ar_only/);
    expect(stage(events, "ar_qr_opened")).toHaveLength(0);
  } else {
    await expect.poll(() => stage(events, "ar_qr_opened").length).toBe(1);
    const url = new URL((await page.getByRole("dialog").locator("a").getAttribute("href"))!);
    expect(url.pathname).toBe(`/ar/${slug}`); expect(url.searchParams.get("ar_entry")).toBe("qr"); expect(url.searchParams.get("ar_variant")).toBe("B"); expect(url.searchParams.get("utm_content")).toBe("video1");
    expect(stage(events, "ar_attempted")).toHaveLength(0);
  }
  for (const event of events.filter(e => e.type === "PRODUCT_AR")) expect(event.metadata).toMatchObject({ variant: "B", source: "facebook", campaign: "desk", content: "video1" });
});
test("essential-only visitors can use 3D and AR with no analytics or experiment storage", async ({ page, isMobile }) => {
  const events = await setup(page, false);
  const counts: Array<{slug: string; event: string}> = [];
  await page.route("**/api/product-ar/count", async route => {
    const request = route.request();
    expect(request.headers()["cookie"]).toBeUndefined();
    expect(request.headers()["referer"]).toBeUndefined();
    const body = request.postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["event", "slug"]);
    counts.push(body); await route.fulfill({status:204});
  });
  await page.goto(`/p/${slug}`);
  await model(page);
  await page.getByRole("button", { name: "Nazad na fotografije" }).click();
  if (isMobile) await page.evaluate(() => { HTMLAnchorElement.prototype.click = function() {}; });
  await page.getByRole("button", { name: /^(Pogledaj u svojoj sobi|Isprobaj u svojoj sobi)$/ }).click();
  await expect.poll(() => counts.map(c => c.event)).toEqual(["model_opened", "ar_clicked"]);
  expect(events).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem("spc:ar-copy-v2"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("spc:ar-traffic-v1"))).toBeNull();
});
test("QR phone landing is distinct from its native AR launch attempt", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone QR funnel");
  const events = await setup(page, true, "A");
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.href.startsWith("intent:")) { this.addEventListener("click", e => e.preventDefault(), { once: true }); }
      click.call(this);
    };
  });
  await page.goto(`/ar/${slug}?ar_entry=qr&ar_variant=B&utm_source=facebook&utm_campaign=desk&utm_content=video1`);
  await expect.poll(() => stage(events, "ar_qr_landed").length).toBe(1);
  await expect.poll(() => stage(events, "ar_attempted").length).toBe(1);
  expect(stage(events, "model_opened")).toHaveLength(0);
  expect(stage(events, "ar_qr_landed")[0].metadata).toMatchObject({ variant: "B", campaign: "desk", content: "video1" });
});
test("mobile model arrows return to photos without intercepting rotation", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile navigation");
  await setup(page, false);
  await page.goto(`/p/${slug}`); await model(page);
  await page.getByRole("button", { name: "Prethodna slika", exact: true }).filter({ visible: true }).click();
  await expect(page.locator("model-viewer")).toHaveCount(0);
});

test("background preparation is not a 3D view; campaign survives a later visit without UTM", async ({ page }) => {
  const events = await setup(page, true, "A");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: false, effectiveType: "4g" } });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
  });
  await page.goto(`/p/${slug}?utm_source=facebook&utm_campaign=desk&utm_content=video1`);
  await expect(page.locator("[data-ar-warm-ready]")).toHaveCount(1, { timeout: 45000 });
  expect(stage(events, "model_opened")).toHaveLength(0);
  expect(stage(events, "model_used")).toHaveLength(0);
  await page.goto(`/p/${slug}`);
  await expect(page.getByRole("button", { name: "Pogledaj u svojoj sobi", exact: true })).toBeVisible();
  await model(page);
  await expect.poll(() => stage(events, "model_opened").length).toBe(1);
  expect(stage(events, "model_opened")[0].metadata).toMatchObject({ variant: "A", campaign: "desk", content: "video1" });
});

// Prevent browser checks from writing aggregate counts to the catalog database.
test.beforeEach(async ({ page }) => { await page.route("**/api/product-ar/count", route => route.fulfill({ status: 204 })); });

test("room CTA explanation fits one line on narrow phones and desktop", async ({ page, isMobile }) => {
  await setup(page, false);
  if (isMobile) await page.setViewportSize({width:320,height:740});
  await page.goto(`/p/${slug}`);
  const caption = page.locator("[data-ar-caption]").filter({visible:true});
  await expect(caption).toHaveText("Uz kameru telefona, vidi ga u sobi.");
  const box = await caption.evaluate(el => ({width:el.clientWidth, scroll:el.scrollWidth, height:el.getBoundingClientRect().height, line:parseFloat(getComputedStyle(el).lineHeight)}));
  expect(box.scroll).toBeLessThanOrEqual(box.width);
  expect(box.height).toBeLessThanOrEqual(box.line + 1);
});
