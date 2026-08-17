// Acceptance: ADMIN-01
// Acceptance: CONTENT-03
// Acceptance: REDIRECT-01
// Acceptance: CONTENT-06
// Acceptance: REDIRECT-03
// Acceptance: CONTENT-09
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

test.describe("ERP critical cross-browser smoke", () => {
  test.skip(
    process.env.E2E_ERP_CRITICAL_SMOKE !== "1",
    "Set E2E_ERP_CRITICAL_SMOKE=1 to run auth, navigation and export smoke.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const adminEmail = `qa.erp.smoke.${runId}@example.invalid`;
  const adminPassword = `QaErpSmoke!${runId}x`;
  let db: PrismaClient;
  let adminId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "ERP smoke",
      },
      select: { id: true },
    });
    adminId = admin.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
    await db.$disconnect();
  });

  test("redirects anonymous admins and keeps canonical ERP navigation and XLSX export healthy", async ({
    page,
  }, testInfo) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await page.goto("/admin/erp", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/prijava\?callbackUrl=/);

    await login(page, "/admin");
    await expect(
      page.getByRole("heading", { name: "Kontrolna tabla", exact: true }),
    ).toBeVisible();

    for (const route of [
      "/admin/erp",
      "/admin/erp/artikli",
      "/admin/erp/stanje-po-magacinima",
      "/admin/erp/prodajni-nalozi",
      "/admin/erp/reklamacije-dnevnik",
      "/admin/tabovi",
      "/admin/pocetna",
    ]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}(?:[?#]|$)`));
    }

    await page.goto("/admin/erp/artikli", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-client-ready="true"]')).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Excel", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/artikli.*\.xlsx$/i);
    const failure = await download.failure();
    expect(failure).toBeNull();

    for (const legacyRoute of [
      "/admin/proizvodi",
      "/admin/akcije",
      "/admin/heroji",
      "/admin/erp/heroji-meseca",
      "/admin/narudzbine",
      "/admin/lager",
      "/admin/reklamacije",
    ]) {
      const response = await page.request.get(legacyRoute, { maxRedirects: 0 });
      expect(response.status(), legacyRoute).toBe(404);
    }

    const unexpected = runtimeErrors.filter(
      (message) =>
        !message.includes("favicon") &&
        !message.includes("server responded with a status of 404") &&
        !(
          testInfo.project.name === "webkit" &&
          message.includes("_rsc=") &&
          message.includes("due to access control checks")
        ),
    );
    expect(unexpected).toEqual([]);
  });

  async function login(page: Page, callbackUrl: string) {
    await page.goto(
      `/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin(?:[?#]|$)/, { timeout: 90_000 });
  }
});

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for ERP critical smoke.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
