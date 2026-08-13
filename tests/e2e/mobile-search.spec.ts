import { expect, test, type Page, type Route } from "@playwright/test";

const viewports = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const suggestionHits = [
  {
    type: "category",
    id: "qa-mopovi",
    name: "Mopovi i oprema",
    href: "/k/mopovi",
    breadcrumb: "Kućni aparati",
  },
  {
    type: "category",
    id: "qa-akcija",
    name: "Mopovi na akciji",
    href: "/akcija",
    breadcrumb: "Akcija",
  },
];

test.describe("mobilna fullscreen pretraga", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ context, page }) => {
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await page.route("**/api/analytics/events", (route) =>
      route.fulfill({ status: 204 }),
    );
  });

  for (const viewport of viewports) {
    test(`${viewport.width}px: ispunjava viewport, fokusira polje i čuva CMS blokove`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      let suggestRequests = 0;
      await page.route("**/api/search/suggest**", async (route) => {
        suggestRequests += 1;
        await delayedJson(route, { hits: suggestionHits }, 250);
      });

      await openMobileSearch(page);
      const sheet = page.locator('[data-slot="sheet-content"]');
      await expect
        .poll(async () => (await sheet.boundingBox())?.y)
        .toBe(0);
      const box = await sheet.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBe(0);
      expect(box!.y).toBe(0);
      expect(box!.height).toBe(viewport.height);
      expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
      await expect(mobileSearchInput(page)).toBeFocused();
      await expect(page.getByRole("heading", { name: "Aktuelno" })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Najpopularniji proizvodi" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Najčešće pretrage" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Nazad" })).toHaveCSS(
        "height",
        "44px",
      );

      const input = mobileSearchInput(page);
      await input.fill("ab");
      await page.waitForTimeout(350);
      expect(suggestRequests).toBe(0);
      await expect(
        page.getByText("Unesite najmanje 3 znaka za rezultate."),
      ).toBeVisible();

      await input.fill("mop");
      await expect(page.getByText("Tražim...")).toBeVisible();
      await expect(page.getByRole("option", { name: /Mopovi i oprema/ })).toBeVisible();
      expect(suggestRequests).toBe(1);
      const resultHeading = page.getByRole("heading", {
        name: "Rezultati pretrage",
      });
      await expect(resultHeading).toBeVisible();
      expect(
        await resultHeading.evaluate(
          (heading, currentHeading) =>
            heading.compareDocumentPosition(currentHeading) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          await page.getByRole("heading", { name: "Aktuelno" }).elementHandle(),
        ),
      ).toBeTruthy();
    });
  }

  test("oba CTA pravila navigiraju i zatvaranje resetuje upit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/search/suggest**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: suggestionHits }) }),
    );

    await openMobileSearch(page);
    await page.getByRole("button", { name: "Pogledaj sve" }).click();
    await expect(page).toHaveURL(/\/akcija$/, { timeout: 30_000 });

    await openMobileSearch(page);
    const input = mobileSearchInput(page);
    await expect(input).toHaveValue("");
    await input.fill("mop");
    await expect(page.getByRole("option", { name: /Mopovi i oprema/ })).toBeVisible();
    await page.getByRole("button", { name: /Vidi sve rezultate za „mop“/ }).click();
    await expect(page).toHaveURL(/\/pretraga\?q=mop$/, { timeout: 30_000 });
  });

  test("tastatura menja aktivan rezultat i Enter navigira", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/search/suggest**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: suggestionHits }) }),
    );

    await openMobileSearch(page);
    const input = mobileSearchInput(page);
    await input.fill("mop");
    await expect(page.getByRole("option", { name: /Mopovi i oprema/ })).toBeVisible();
    await input.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", "mobile-search-result-1");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/akcija$/, { timeout: 30_000 });
  });

  test("Escape zatvara overlay i sledeće otvaranje ima prazan upit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/search/suggest**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hits: suggestionHits }) }),
    );
    await openMobileSearch(page);
    const input = mobileSearchInput(page);
    await input.fill("mop");
    await expect(page.getByRole("option", { name: /Mopovi i oprema/ })).toBeVisible();
    await input.press("Escape");
    await expect(page.locator('[data-slot="sheet-content"]')).toBeHidden();
    await triggerMobileSearch(page);
    await expect(input).toHaveValue("");
  });

  test("greška predloga nudi retry, a prazan odgovor ostaje upotrebljiv", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let attempts = 0;
    await page.route("**/api/search/suggest**", (route) => {
      attempts += 1;
      return attempts === 1
        ? route.fulfill({ status: 503, body: "unavailable" })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ hits: [] }),
          });
    });

    await openMobileSearch(page);
    await mobileSearchInput(page).fill("mop");
    await expect(page.getByText(/Predlozi trenutno nisu dostupni/)).toBeVisible();
    await page.getByRole("button", { name: "Pokušaj ponovo" }).click();
    await expect(page.getByText("Nema predloga za „mop“." )).toBeVisible();
    expect(attempts).toBe(2);
    await expect(page.getByRole("heading", { name: "Aktuelno" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Vidi sve rezultate/ })).toBeVisible();
  });
});

async function openMobileSearch(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await triggerMobileSearch(page);
}

async function triggerMobileSearch(page: Page) {
  const trigger = page.getByRole("button", { name: "Pretraži" });
  const sheet = page.locator('[data-slot="sheet-content"]');
  await trigger.click();
  try {
    await sheet.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    // A cold dev-server render can expose HTML before React hydration has
    // attached the trigger handler. Retry once after hydration settles.
    await page.waitForTimeout(750);
    await trigger.click();
    await sheet.waitFor({ state: "visible", timeout: 10_000 });
  }
}

function mobileSearchInput(page: Page) {
  return page
    .getByRole("dialog", { name: "Mobilna pretraga proizvoda" })
    .getByRole("searchbox", { name: "Pretraga proizvoda" });
}

async function delayedJson(route: Route, payload: unknown, delay: number) {
  await new Promise((resolve) => setTimeout(resolve, delay));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}
