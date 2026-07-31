import { expect, test } from "@playwright/test";

test.skip(
  process.env.E2E_LIVE_CATALOG !== "1",
  "Storefront cache smoke requires E2E_LIVE_CATALOG=1 and a read-only catalog database.",
);

test("public product stays cacheable while live availability hydrates", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(60_000);

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
  let availabilityRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/products/") && request.url().endsWith("/availability")) {
      availabilityRequests += 1;
    }
  });

  const catalogResponse = await request.get("/api/products?limit=1");
  expect(catalogResponse.ok()).toBe(true);
  const catalog = (await catalogResponse.json()) as {
    items: Array<{ name: string; slug: string }>;
  };
  expect(catalog.items).not.toHaveLength(0);
  const product = catalog.items[0]!;

  const publicResponse = await request.get(`/p/${product.slug}`);
  expect(publicResponse.status()).toBe(200);
  expect(publicResponse.headers()["cache-control"]).toContain("s-maxage=30");
  expect(publicResponse.headers()["x-nextjs-prerender"]).toBe("1");
  expect(publicResponse.headers()["set-cookie"]).toBeUndefined();

  const availabilityPromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/products/${product.slug}/availability`) &&
      response.status() === 200,
  );
  await page.goto(`/p/${product.slug}`, { waitUntil: "domcontentloaded" });
  const availabilityResponse = await availabilityPromise;
  await page.waitForTimeout(250);
  expect(availabilityRequests).toBe(1);
  const payload = (await availabilityResponse.json()) as {
    availability: { addLabel: string; message: string };
  };

  await expect(
    page.getByRole("heading", { level: 1, name: product.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("article > section").first().getByRole("button", {
      name: payload.availability.addLabel,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('p[aria-live="polite"]:visible')).toContainText(
    payload.availability.message,
  );
});
