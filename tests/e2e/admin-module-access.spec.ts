import { expect, test, type BrowserContext } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";

test.describe("isolated module permissions", () => {
  test.skip(process.env.E2E_ADMIN_MODULE_ACCESS !== "1", "Requires the isolated permissions QA database.");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  const run = `${Date.now()}-${process.pid}`;
  const prefix = `qa.modules.${run}`;
  const password = `QaModules!${run}`;
  let db: PrismaClient;
  let superId: string;
  let customId: string;
  let warehouseUserId: string;
  const policy = (...modules: string[]) => ({ version: 1, modules });

  test.beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 2 }) });
    const passwordHash = await bcrypt.hash(password, 10);
    superId = (await db.adminUser.create({ data: { email: `${prefix}.super@example.invalid`, passwordHash, role: "SUPER" } })).id;
    customId = (await db.adminUser.create({ data: { email: `${prefix}.custom@example.invalid`, passwordHash, role: "CUSTOM",
      accessPolicy: policy("/admin/newsletter", "/admin/erp/porudzbenice") } })).id;
    warehouseUserId = (await db.adminUser.create({ data: { email: `${prefix}.warehouse@example.invalid`, passwordHash, role: "WAREHOUSE",
      accessPolicy: policy("/admin/magacin") } })).id;
  });
  test.afterAll(async () => {
    const admins = await db.adminUser.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
    const ids = admins.map(user => user.id);
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.adminSavedView.deleteMany({ where: { adminUserId: { in: ids } } });
    await db.adminUser.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  test("SUPER creates Marketing without the shared Viber/SMS module", async ({ context, page }) => {
    await authenticate(context, superId);
    await page.goto("/admin/erp/operativci");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Napravi korisnički nalog", exact: true }) });
    await form.getByLabel("Ime", { exact: true }).fill("QA modules");
    await form.getByLabel("E-pošta za prijavu").fill(`${prefix}.created@example.invalid`);
    await form.getByLabel("Lozinka (najmanje 8 znakova)").fill(password);
    await form.getByRole("checkbox", { name: "Marketing", exact: true }).check();
    await form.getByRole("checkbox", { name: "Viber i SMS", exact: true }).uncheck();
    await expect(form.getByRole("checkbox", { name: "Marketing", exact: true })).toHaveAttribute("aria-checked", "mixed");
    await form.getByRole("button", { name: "Napravi korisnički nalog", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Korisnički nalog je napravljen" })).toBeVisible();
    const created = await db.adminUser.findUniqueOrThrow({ where: { email: `${prefix}.created@example.invalid` } });
    expect(created.role).toBe("CUSTOM");
    expect(created.accessPolicy).toEqual(policy("/admin/newsletter", "/admin/oglasi"));
    expect(await bcrypt.compare(password, created.passwordHash)).toBe(true);
    const audit = await db.auditLog.findMany({ where: { actorId: superId } });
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(JSON.stringify(audit)).not.toContain(created.passwordHash);
  });

  test("mixed account sees only granted shortcuts and rejects direct URL/API and forged cross-module commands", async ({ context, page }) => {
    await authenticate(context, customId);
    await page.goto("/admin/erp");
    await expect(page.getByRole("link", { name: "Viber i SMS", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/admin/viber"]')).toHaveCount(0);
    await expect(page.locator('a[href="/admin/erp/artikli"]')).toHaveCount(0);
    await page.goto("/admin/newsletter");
    await expect(page).toHaveURL(/\/admin\/newsletter$/);
    const allowed = await context.request.get("/api/admin/erp/porudzbenice/rows?pageSize=2", { maxRedirects: 0 });
    expect(allowed.status()).toBe(200);
    const saved = await context.request.post("/api/admin/saved-views", { data: {
      module: "porudzbenice", name: `QA modules ${run}`, visibleColumns: ["number"], columnOrder: ["number"],
    } });
    expect(saved.status()).toBe(200);
    const views = await context.request.get("/api/admin/saved-views?module=porudzbenice");
    expect(views.status()).toBe(200);
    expect((await views.json()).views.some((view: { name: string }) => view.name === `QA modules ${run}`)).toBe(true);
    for (const url of ["/api/admin/erp/artikli/rows", "/api/admin/saved-views?module=artikli"]) {
      const denied = await context.request.get(url, { maxRedirects: 0 });
      expect([307, 403]).toContain(denied.status());
    }
    const command = await context.request.post("/api/admin/erp/porudzbenice/commands", { data: { action: "newsletter.create", payload: {} }, maxRedirects: 0 });
    expect([400, 403]).toContain(command.status());
    await page.goto("/admin/viber");
    await expect(page).toHaveURL(/\/admin\/pristup-odbijen$/);
    await page.goto("/admin/erp/operativci");
    await expect(page).toHaveURL(/\/admin\/pristup-odbijen$/);
  });

  test("a warehouse-only policy keeps the warehouse shell and rejects other ERP modules", async ({ context, page }) => {
    await authenticate(context, warehouseUserId);
    await page.goto("/admin/magacin");
    await expect(page.getByRole("link", { name: "Picking", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Povrat", exact: true })).toBeVisible();
    await page.goto("/admin/erp/artikli");
    await expect(page).toHaveURL(/\/admin\/pristup-odbijen$/);
    const response = await context.request.get("/api/admin/erp/artikli/rows", { maxRedirects: 0 });
    expect([307, 403]).toContain(response.status());
  });

  test("module removal and account deactivation apply during the same signed-in session", async ({ context, page }) => {
    await db.adminUser.update({ where: { id: customId }, data: { accessPolicy: policy("/admin/viber", "/admin/newsletter") } });
    await authenticate(context, customId);
    await page.goto("/admin/viber");
    await expect(page).toHaveURL(/\/admin\/viber$/);
    await db.adminUser.update({ where: { id: customId }, data: { accessPolicy: policy("/admin/newsletter") } });
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/pristup-odbijen$/);
    const denied = await context.request.post("/api/admin/viber-media", { data: {}, maxRedirects: 0 });
    expect([307, 403]).toContain(denied.status());
    await page.goto("/admin/newsletter");
    await expect(page).toHaveURL(/\/admin\/newsletter$/);
    await db.adminUser.update({ where: { id: customId }, data: { enabled: false } });
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/prijava/);
  });

  async function authenticate(context: BrowserContext, id: string) {
    const cookie = "authjs.session-token";
    const token = await encode({ secret: process.env.AUTH_SECRET!, salt: cookie, maxAge: 3600,
      token: { sub: id, uid: id, userType: "admin", role: "SUPER" } }); // Intentionally stale/forged role: DB wins.
    await context.addCookies([{ name: cookie, value: token, url: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`, httpOnly: true, sameSite: "Lax" }]);
  }
});
