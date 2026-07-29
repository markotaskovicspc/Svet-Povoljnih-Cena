import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@generated/prisma-client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("newsletter admin acceptance", () => {
  test.skip(process.env.E2E_NEWSLETTER !== "1", "Set E2E_NEWSLETTER=1 to run the isolated newsletter acceptance suite.");
  test.setTimeout(240_000);
  const acceptanceExpect = expect.configure({ timeout: 30_000 });

  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-NEWSLETTER-${runId}`;
  const adminEmail = `qa.newsletter.admin.${runId}@example.invalid`;
  const adminPassword = `QaNewsletter!${runId}`;
  const contactEmails = [
    `qa.newsletter.one.${runId}@example.invalid`,
    `qa.newsletter.two.${runId}@example.invalid`,
  ];
  const audienceName = `${tag} ručna publika`;
  const campaignTitle = `${tag} kampanja`;

  let db: PrismaClient;
  let adminId: string | null = null;
  let audienceId: string | null = null;
  let campaignId: string | null = null;
  let contactIds: string[] = [];

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Newsletter",
      },
      select: { id: true },
    });
    adminId = admin.id;
    for (const [index, email] of contactEmails.entries()) {
      const contact = await db.marketingContact.create({
        data: {
          email,
          firstName: index === 0 ? "Ana" : "Marko",
          lastName: "QA",
          status: "ACTIVE",
          source: "e2e",
          consentVersion: "e2e-v1",
          subscribedAt: new Date(),
          confirmedAt: new Date(),
          consentEvents: {
            create: { type: "CONFIRMED", source: "e2e", consentVersion: "e2e-v1" },
          },
        },
        select: { id: true },
      });
      contactIds.push(contact.id);
      await db.newsletterSubscriber.create({ data: { email, consent: true, source: "e2e" } });
    }
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("admin builds a manual audience, versions a campaign, tests, approves and sends it", async ({ context, page }) => {
    await context.addCookies([{ name: "spc_cookie_consent", value: "essential", url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3018" }]);
    await login(page);

    await test.step("audience preview and save only include explicitly selected contacts", async () => {
      await page.goto("/admin/newsletter?view=audiences", { waitUntil: "domcontentloaded" });
      await page.locator('input[name="name"]').fill(audienceName);
      await page.locator('input[name="description"]').fill("Izolovana ručna QA publika.");
      await page.getByText("Ručni izbor i isključenja", { exact: true }).click();
      await page.locator("select[multiple]").first().selectOption(contactIds);
      await page.getByRole("button", { name: "Prikaži veličinu publike" }).click();
      await acceptanceExpect(page.getByText("2 podobnih kontakata")).toBeVisible();
      await page.getByRole("button", { name: "Sačuvaj publiku" }).click();
      await acceptanceExpect(page.getByRole("status")).toContainText("Trenutno odgovara 2 kontakata");
      audienceId = (await db.newsletterAudience.findUniqueOrThrow({ where: { name: audienceName }, select: { id: true, estimatedCount: true } })).id;
    });

    await test.step("campaign composer saves an immutable version and test send", async () => {
      await page.goto("/admin/newsletter", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "+ Nova kampanja" }).first().click();
      await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter\/kampanje\/[^/]+$/);
      campaignId = page.url().split("/").pop()!;
      const editorForms = page.locator("form#newsletter-campaign-editor:visible");
      await acceptanceExpect.poll(() => editorForms.count()).toBe(1);
      const editorForm = editorForms.first();
      await acceptanceExpect(editorForm).toBeVisible();
      await editorForm.locator('input[name="title"]').fill(campaignTitle);
      await editorForm.locator('input[name="subject"]').fill(`${tag} — samo danas`);
      await editorForm.locator('input[name="previewText"]').fill("QA preview tekst");
      await editorForm.locator('select[name="audienceId"]').selectOption(audienceId!);
      await editorForm.locator('select[name="audienceMode"]').selectOption("FIXED");
      await editorForm.getByRole("button", { name: "Sačuvaj novu verziju" }).click();
      await acceptanceExpect.poll(async () => db.newsletterCampaignVersion.count({ where: { campaignId: campaignId! } })).toBe(2);
      await acceptanceExpect(editorForm.locator('select[name="audienceId"]')).toHaveValue(audienceId!);
      await acceptanceExpect(editorForm.locator('select[name="audienceMode"]')).toHaveValue("FIXED");

      const testForms = page.locator("form#newsletter-campaign-test-send:visible");
      await acceptanceExpect.poll(() => testForms.count()).toBe(1);
      const testForm = testForms.first();
      await acceptanceExpect(testForm).toBeVisible();
      await testForm.locator('input[name="email"]').fill(adminEmail);
      await testForm.getByRole("button", { name: "Pošalji test" }).click();
      await acceptanceExpect.poll(async () => db.emailMessage.count({ where: { recipient: adminEmail, kind: "newsletter_test", status: "SENT" } })).toBe(1);
    });

    await test.step("review, approval and immediate simulated send preserve final eligibility", async () => {
      await page.getByRole("button", { name: "Pošalji na proveru" }).click();
      await acceptanceExpect(page.getByRole("button", { name: "Odobri kampanju" })).toBeVisible();
      await page.getByRole("button", { name: "Odobri kampanju" }).click();
      await acceptanceExpect(page.getByRole("button", { name: "Pošalji odmah" })).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Pošalji odmah" }).click();
      await acceptanceExpect(page.getByText(/Zakazana · verzija 2/)).toBeVisible();

      const secret = process.env.BACKGROUND_JOBS_CRON_SECRET ?? process.env.CRON_SECRET;
      if (!secret) throw new Error("Newsletter acceptance requires CRON_SECRET or BACKGROUND_JOBS_CRON_SECRET.");
      await acceptanceExpect.poll(async () => {
        const response = await page.request.post("/api/cron/background-jobs?limit=25", {
          headers: { authorization: `Bearer ${secret}` },
        });
        if (!response.ok()) throw new Error(`Background worker returned ${response.status()}: ${await response.text()}`);
        return db.newsletterCampaign.findUnique({ where: { id: campaignId! }, select: { status: true, delivered: true, recipients: true } });
      }, { intervals: [500, 1_000, 2_000] }).toEqual({ status: "SENT", delivered: 2, recipients: 2 });
      await acceptanceExpect.poll(async () => db.newsletterCampaignRecipient.count({ where: { campaignId: campaignId!, status: "DELIVERED" } })).toBe(2);

      await page.reload({ waitUntil: "domcontentloaded" });
      await acceptanceExpect(page.getByText("Poslata · verzija 2")).toBeVisible();
      await acceptanceExpect(page.getByText("Isporučena").first()).toBeVisible();
    });

    await test.step("all workflow mutations are audited", async () => {
      const actions = new Set((await db.auditLog.findMany({ where: { actorId: adminId! }, select: { action: true } })).map((entry) => entry.action));
      for (const action of [
        "newsletter.audience.save",
        "newsletter.campaign.create",
        "newsletter.campaign.save",
        "newsletter.campaign.test",
        "newsletter.campaign.submitReview",
        "newsletter.campaign.approve",
        "newsletter.campaign.sendNow",
      ]) expect(actions, `Missing audit action ${action}`).toContain(action);
      expect([...actions].filter((action) => action.endsWith(".error"))).toEqual([]);
    });
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin%2Fnewsletter", { waitUntil: "domcontentloaded" });
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter/);
  }

  async function cleanup() {
    if (!db) return;
    const campaigns = await db.newsletterCampaign.findMany({ where: { title: { startsWith: tag } }, select: { id: true } }).catch(() => []);
    const ids = Array.from(new Set([...campaigns.map((campaign) => campaign.id), ...(campaignId ? [campaignId] : [])]));
    if (ids.length) {
      await db.backgroundJob.deleteMany({ where: { OR: ids.map((id) => ({ idempotencyKey: `newsletter-send:${id}` })) } });
      await db.newsletterCampaign.deleteMany({ where: { id: { in: ids } } });
    }
    await db.newsletterAudience.deleteMany({ where: { name: audienceName } }).catch(() => undefined);
    await db.newsletterSubscriber.deleteMany({ where: { email: { in: contactEmails } } }).catch(() => undefined);
    await db.marketingContact.deleteMany({ where: { email: { in: contactEmails } } }).catch(() => undefined);
    await db.emailMessage.deleteMany({ where: { recipient: adminEmail } }).catch(() => undefined);
    const admin = await db.adminUser.findUnique({ where: { email: adminEmail }, select: { id: true } });
    if (admin) await db.auditLog.deleteMany({ where: { actorId: admin.id } });
    await db.rateLimitBucket.deleteMany({ where: { key: { contains: adminEmail } } });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
    adminId = null;
    audienceId = null;
    campaignId = null;
    contactIds = [];
  }
});

function createDatabaseClient() {
  const raw = [process.env.DATABASE_URL, process.env.POSTGRES_PRISMA_URL, process.env.POSTGRES_URL, process.env.POSTGRES_URL_NON_POOLING].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for newsletter acceptance.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set("sslmode", process.env.DATABASE_SSLMODE?.trim() || "no-verify");
    url.searchParams.delete("uselibpqcompat");
  }
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 15_000 }, { schema }) });
}
