// Acceptance: MARKO-44
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("lični admin meni je odvojen po korisniku", () => {
  test.skip(
    process.env.E2E_ADMIN_NAV_PREFS !== "1",
    "Set E2E_ADMIN_NAV_PREFS=1 with an isolated E2E database.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const accounts = [
    {
      email: `qa.nav.a.${runId}@example.invalid`,
      password: `QaNavA!${runId}x`,
      firstName: "Meni A",
      href: "/admin/erp/akcije",
      label: "Cene i promocije",
      hiddenHref: "/admin/erp/magacini",
      hiddenLabel: "Magacini",
    },
    {
      email: `qa.nav.b.${runId}@example.invalid`,
      password: `QaNavB!${runId}x`,
      firstName: "Meni B",
      href: "/admin/erp/magacini",
      label: "Magacini",
      hiddenHref: "/admin/erp/akcije",
      hiddenLabel: "Cene i promocije",
    },
  ] as const;
  let db: PrismaClient;
  const adminIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    for (const account of accounts) {
      const admin = await db.adminUser.create({
        data: {
          email: account.email,
          passwordHash: await bcrypt.hash(account.password, 10),
          role: "SUPER",
          enabled: true,
          firstName: account.firstName,
          lastName: "QA",
        },
        select: { id: true },
      });
      adminIds.push(admin.id);
    }
  });

  test.afterAll(async () => {
    if (!db) return;
    if (adminIds.length) {
      await db.auditLog.deleteMany({ where: { actorId: { in: adminIds } } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { OR: accounts.map((account) => ({ key: { contains: account.email } })) },
    });
    await db.adminUser.deleteMany({
      where: { email: { in: accounts.map((account) => account.email) } },
    });
    await db.$disconnect();
  });

  test("desktop, mobile i API ne mešaju preference dva admina", async ({
    browser,
  }) => {
    const contextA = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const contextB = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await login(pageA, accounts[0]);
      await login(pageB, accounts[1]);

      const responseA = await saveMenu(pageA, accounts[0].href);
      const responseB = await saveMenu(pageB, accounts[1].href);
      expect(responseA.status()).toBe(200);
      expect(responseB.status()).toBe(200);
      const viewA = (await responseA.json()) as { view: { id: string } };
      const viewB = (await responseB.json()) as { view: { id: string } };

      const rows = await db.adminSavedView.findMany({
        where: { id: { in: [viewA.view.id, viewB.view.id] } },
        select: { id: true, adminUserId: true, columns: true },
      });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.adminUserId))).toEqual(
        new Set(adminIds),
      );

      await assertDesktopMenu(pageA, accounts[0]);
      await assertDesktopMenu(pageB, accounts[1]);

      const crossUserDelete = await pageA.request.delete(
        "/api/admin/saved-views",
        { data: { id: viewB.view.id } },
      );
      expect(crossUserDelete.status()).toBe(404);
      await expect
        .poll(() =>
          db.adminSavedView.count({ where: { id: viewB.view.id } }),
        )
        .toBe(1);

      await pageA.setViewportSize({ width: 390, height: 844 });
      await pageA.goto("/admin", { waitUntil: "domcontentloaded" });
      await pageA.getByRole("button", { name: "Otvori meni" }).click();
      const mobileNav = pageA.getByTestId("admin-mobile-nav-scroll");
      await expect(mobileNav.getByRole("link", { name: accounts[0].label })).toBeVisible();
      await expect(
        mobileNav.getByRole("link", { name: accounts[0].hiddenLabel }),
      ).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  async function saveMenu(page: Page, href: string) {
    return page.request.post("/api/admin/saved-views", {
      data: {
        module: "admin-navigation",
        name: "Levi meni",
        query: "",
        filters: [],
        sorting: [],
        visibleColumns: ["/admin", href],
        columnOrder: ["/admin", href],
        columnWidths: {},
        context: {},
        isDefault: true,
      },
    });
  }

  async function assertDesktopMenu(
    page: Page,
    account: (typeof accounts)[number],
  ) {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const nav = page.locator("aside nav");
    await expect(nav.getByRole("link", { name: account.label })).toBeVisible();
    await expect(nav.getByRole("link", { name: account.hiddenLabel })).toHaveCount(0);
  }
});

async function login(
  page: Page,
  account: { email: string; password: string },
) {
  await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("E-pošta").fill(account.email);
  await page.getByLabel("Lozinka").fill(account.password);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page).toHaveURL(/\/admin(?:[?#]|$)/, { timeout: 90_000 });
}

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is required for admin navigation acceptance.");
  }
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url.toString(),
        max: 1,
        connectionTimeoutMillis: 15_000,
      },
      { schema },
    ),
  });
}
