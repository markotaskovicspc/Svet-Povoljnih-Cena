import { expect, test } from "@playwright/test";

const cases = [
  { role: "SUPER", allowed: "/admin/audit-log", denied: null },
  { role: "CONTENT", allowed: "/admin/proizvodi", denied: "/admin/narudzbine" },
  { role: "OPS", allowed: "/admin/lager", denied: "/admin/pocetna" },
  { role: "ADS", allowed: "/admin/oglasi", denied: "/admin/lager" },
] as const;

for (const roleCase of cases) {
  test(`${roleCase.role} admin access matrix`, async ({ page }) => {
    const email = process.env[`E2E_ADMIN_${roleCase.role}_EMAIL`];
    const password = process.env[`E2E_ADMIN_${roleCase.role}_PASSWORD`];
    const missingCredentials = !email || !password;
    test.skip(!process.env.CI && missingCredentials, `Missing tagged ${roleCase.role} E2E credentials.`);
    if (missingCredentials) {
      throw new Error(`CI requires ${roleCase.role} E2E credentials.`);
    }

    await page.goto(`/admin/prijava?callbackUrl=${encodeURIComponent(roleCase.allowed)}`);
    await page.getByLabel("E-pošta").fill(email!);
    await page.getByLabel("Lozinka").fill(password!);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(new RegExp(roleCase.allowed.replaceAll("/", "\\/")));

    if (roleCase.denied) {
      await page.goto(roleCase.denied);
      await expect(page).toHaveURL(/\/admin\?forbidden=1/);
    }
  });
}
