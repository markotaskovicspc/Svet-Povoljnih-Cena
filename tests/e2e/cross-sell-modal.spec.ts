import { expect, test, type Page } from "@playwright/test";
import type { Product } from "@/types";

test.skip(
  process.env.E2E_CROSS_SELL !== "1",
  "Cross-sell acceptance uses the configured read-only storefront catalog.",
);
test.setTimeout(120_000);

const recommendations = Array.from({ length: 6 }, (_, index) =>
  recommendationProduct(index),
);

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    {
      name: "spc_cookie_consent",
      value: "essential",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    },
    {
      name: "spc_cookie_consent_version",
      value: "2026-08-meta",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.removeItem("spc-cart");
  });
  await page.route("**/api/analytics/events", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/products/*/availability", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, message: null }),
    }),
  );
  await page.route("**/api/cart/recommendations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: recommendations }),
    }),
  );
  await page.route("**/api/products/lookup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: [] }),
    }),
  );
});

test("keeps six recommendation cards inside the modal at every target width", async ({
  page,
}) => {
  await openCrossSell(page);

  await assertResponsiveLayout(page, {
    width: 320,
    height: 568,
    columns: 1,
  });
  await assertResponsiveLayout(page, {
    width: 375,
    height: 667,
    columns: 2,
  });
  await assertResponsiveLayout(page, {
    width: 390,
    height: 844,
    columns: 2,
  });
  await assertResponsiveLayout(page, {
    width: 768,
    height: 900,
    columns: 3,
  });
  await assertResponsiveLayout(page, {
    width: 1280,
    height: 800,
    columns: 3,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const firstCard = page.getByTestId("purchase-suggestion-card").first();
  await firstCard.getByRole("button", { name: "Dodaj u korpu" }).click();
  await expect(
    page
      .getByTestId("purchase-suggestion-card")
      .first()
      .getByRole("group", { name: "Količina u korpi" }),
  ).toBeVisible();
});

test("supports keyboard dismissal and explicit cart navigation", async ({
  page,
}) => {
  await openCrossSell(page);
  await expect(
    page.getByRole("button", { name: "Zatvori predlog kupovine" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cross-sell-dialog")).toBeHidden();

  await resetAndOpenCrossSell(page);
  await page.getByRole("button", { name: "Ostani u kupovini" }).click();
  await expect(page.getByTestId("cross-sell-dialog")).toBeHidden();

  await resetAndOpenCrossSell(page);
  await page.getByRole("button", { name: "Nastavi ka korpi" }).click();
  await expect(page).toHaveURL(/\/korpa$/);
});

async function openCrossSell(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pretraga?q=RELAX", { waitUntil: "domcontentloaded" });
  const addButton = page.getByRole("button", { name: "Dodaj u korpu" }).first();
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  await addButton.click();
  await expect(page.getByTestId("cross-sell-dialog")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("purchase-suggestion-card")).toHaveCount(6);
}

async function resetAndOpenCrossSell(page: Page) {
  await page.evaluate(() => window.localStorage.removeItem("spc-cart"));
  await page.reload({ waitUntil: "domcontentloaded" });
  const addButton = page.getByRole("button", { name: "Dodaj u korpu" }).first();
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  await addButton.click();
  await expect(page.getByTestId("cross-sell-dialog")).toBeVisible({
    timeout: 15_000,
  });
}

async function assertResponsiveLayout(
  page: Page,
  viewport: { width: number; height: number; columns: 1 | 2 | 3 },
) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const dialog = page.getByTestId("cross-sell-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(150);

  const diagnostics = await dialog.evaluate((element) => {
    const dialogRect = element.getBoundingClientRect();
    const scrollArea = element.querySelector<HTMLElement>(
      '[data-testid="cross-sell-scroll-area"]',
    );
    const footer = element.querySelector<HTMLElement>(
      '[data-testid="cross-sell-footer"]',
    );
    const cards = Array.from(
      element.querySelectorAll<HTMLElement>(
        '[data-testid="purchase-suggestion-card"]',
      ),
    );
    const overflow = cards.flatMap((card, cardIndex) => {
      const cardRect = card.getBoundingClientRect();
      const important = Array.from(
        card.querySelectorAll<HTMLElement>(
          '[data-testid="purchase-suggestion-price"], [data-testid="purchase-suggestion-cart-control"], [data-product-variants]',
        ),
      );
      return important
        .filter((item) => {
          const rect = item.getBoundingClientRect();
          return (
            rect.left < cardRect.left - 1 ||
            rect.right > cardRect.right + 1 ||
            rect.width > cardRect.width + 1
          );
        })
        .map((item) => `${cardIndex}:${item.textContent?.trim() ?? "control"}`);
    });
    const cardPositions = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    });
    const footerRect = footer?.getBoundingClientRect();

    return {
      dialog: {
        left: dialogRect.left,
        right: dialogRect.right,
        top: dialogRect.top,
        bottom: dialogRect.bottom,
      },
      footer: footerRect
        ? { top: footerRect.top, bottom: footerRect.bottom }
        : null,
      scrollOverflow:
        scrollArea == null
          ? null
          : scrollArea.scrollWidth - scrollArea.clientWidth,
      overflow,
      cardPositions,
    };
  });

  expect(diagnostics.dialog.left).toBeGreaterThanOrEqual(-1);
  expect(diagnostics.dialog.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(diagnostics.dialog.top).toBeGreaterThanOrEqual(-1);
  expect(diagnostics.dialog.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(diagnostics.footer).not.toBeNull();
  expect(diagnostics.footer!.top).toBeGreaterThanOrEqual(0);
  expect(diagnostics.footer!.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(diagnostics.scrollOverflow ?? 1).toBeLessThanOrEqual(1);
  expect(diagnostics.overflow).toEqual([]);

  const [first, second, third] = diagnostics.cardPositions;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  if (viewport.columns === 1) {
    expect(Math.abs(first!.x - second!.x)).toBeLessThanOrEqual(1);
    expect(second!.y).toBeGreaterThan(first!.y);
  } else if (viewport.columns === 2) {
    expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(1);
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(third!.y).toBeGreaterThan(first!.y);
  } else {
    expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(first!.y - third!.y)).toBeLessThanOrEqual(1);
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(third!.x).toBeGreaterThan(second!.x);
  }
}

function recommendationProduct(index: number): Product {
  const fullPrices = [99_999, 3_570, 22_856, 5_713, 44_990, 18_490];
  const salePrices = [49_999, 2_499, undefined, 3_699, 29_990, undefined];
  const fullPrice = fullPrices[index]!;
  const salePrice = salePrices[index];
  const sku = `QA-CROSS-SELL-${index + 1}`;
  const base: Product = {
    id: `qa-cross-sell-${index + 1}`,
    sku,
    slug: `qa-cross-sell-${index + 1}`,
    name:
      index === 0
        ? "Kompjuterski sto sa policama i posebno dugim nazivom proizvoda"
        : `Predloženi artikal ${index + 1}`,
    group: "qa-cross-sell",
    categoryPath: ["QA", "Predlozi kupovine"],
    description: "Deterministički cross-sell proizvod za responsive proveru.",
    dimensionsCm: { w: 120 + index, d: 60, h: 75 },
    materials: [],
    pictograms: Array.from({ length: 3 }, (_, pictogramIndex) => ({
      id: `${sku}-pictogram-${pictogramIndex}`,
      code: `QA-${pictogramIndex}`,
      label: `Pogodnost ${pictogramIndex + 1}`,
      iconUrl: "/logo.jpeg",
    })),
    stock: index === 5 ? 0 : 5,
    incomingStock: 0,
    availabilitySource: index === 2 ? "SUPPLIER" : index === 5 ? "NONE" : "DC",
    supplierIntegrationKey: index === 2 ? "RABALUX" : undefined,
    isHero: index === 4,
    isNew: index === 1,
    isLimited: index === 3,
    fullPrice,
    salePrice,
    discountPct:
      salePrice == null ? undefined : Math.round(((fullPrice - salePrice) / fullPrice) * 100),
    loyaltyPrice: index === 2 ? 13_999 : undefined,
    deliveryDays: index === 2 ? { min: 7, max: 10 } : { min: 1, max: 2 },
    allowsAssembly: false,
    assemblyCities: [],
    media: {
      images: [
        {
          url: "/logo.jpeg",
          alt: `Predloženi artikal ${index + 1}`,
        },
      ],
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };

  if (index !== 1) return base;
  return {
    ...base,
    variantFamily: {
      id: "qa-cross-sell-family",
      code: "QA-CROSS-SELL-FAMILY",
      selectedSku: sku,
      options: [
        {
          productId: base.id,
          sku,
          slug: base.slug,
          name: base.name,
          label: "Natur",
          position: 0,
          isPrimary: true,
          thumbnail: base.media.images[0],
          media: base.media,
          fullPrice,
          salePrice,
          discountPct: base.discountPct,
          stock: base.stock,
          incomingStock: 0,
          availabilitySource: "DC",
          deliveryDays: base.deliveryDays,
        },
        {
          productId: "qa-cross-sell-variant-dark",
          sku: "QA-CROSS-SELL-2-DARK",
          slug: "qa-cross-sell-2-dark",
          name: "Predloženi artikal 2 — tamna varijanta",
          label: "Crna",
          position: 1,
          isPrimary: false,
          thumbnail: base.media.images[0],
          media: base.media,
          fullPrice: 4_280,
          salePrice: 2_999,
          discountPct: 30,
          stock: 4,
          incomingStock: 0,
          availabilitySource: "DC",
          deliveryDays: base.deliveryDays,
        },
      ],
    },
  };
}
