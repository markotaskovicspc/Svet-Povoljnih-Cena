import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: "spc_cookie_consent",
    value: "essential",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  }]);
});

test("newsletter only shows success after the API accepts the signup", async ({ page }) => {
  let releaseResponse: (() => void) | undefined;
  await page.route("**/api/newsletter", async (route) => {
    await new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/kontakt", { waitUntil: "domcontentloaded" });
  const section = page.locator("section").filter({ hasText: "Newsletter" }).last();
  const email = section.getByLabel("Email adresa");
  await email.fill("playwright+newsletter@example.com");
  await email.press("Enter");
  await expect(section.getByText("Uspešno ste prijavljeni")).toHaveCount(0);
  releaseResponse?.();
  await expect(section.getByText("Uspešno ste prijavljeni na newsletter.")).toBeVisible();
});

test("newsletter exposes an API failure instead of a false success", async ({ page }) => {
  await page.route("**/api/newsletter", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' }),
  );
  await page.goto("/kontakt", { waitUntil: "domcontentloaded" });
  const section = page.locator("section").filter({ hasText: "Newsletter" }).last();
  const email = section.getByLabel("Email adresa");
  await email.fill("playwright+failure@example.com");
  await email.press("Enter");
  await expect(section.getByRole("alert")).toContainText("trenutno nije moguća");
  await expect(section.getByText("Uspešno ste prijavljeni")).toHaveCount(0);
});
