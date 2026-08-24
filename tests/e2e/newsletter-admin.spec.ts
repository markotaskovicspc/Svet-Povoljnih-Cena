import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import ExcelJS from "exceljs";
import { buildEmailUnsubscribeToken } from "@/lib/email/unsubscribe";
import { sendNewsletterCampaign } from "@/lib/newsletter/campaigns";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("newsletter admin acceptance", () => {
  test.skip(process.env.E2E_NEWSLETTER !== "1", "Set E2E_NEWSLETTER=1 to run the isolated newsletter acceptance suite.");
  test.setTimeout(300_000);
  const acceptanceExpect = expect.configure({ timeout: 30_000 });

  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-NEWSLETTER-${runId}`;
  const adminEmail = `qa.newsletter.admin.${runId}@example.invalid`;
  const adminPassword = `QaNewsletter!${runId}`;
  const reviewerEmail = `qa.newsletter.reviewer.${runId}@example.invalid`;
  const reviewerPassword = `QaNewsletterReviewer!${runId}`;
  const contactEmails = [
    `qa.newsletter.one.${runId}@example.invalid`,
    `qa.newsletter.two.${runId}@example.invalid`,
  ];
  const importEmails = {
    overlap: `qa.newsletter.import.overlap.${runId}@example.invalid`,
    second: `qa.newsletter.import.second.${runId}@example.invalid`,
    pending: `qa.newsletter.import.pending.${runId}@example.invalid`,
    unsubscribed: `qa.newsletter.import.unsubscribed.${runId}@example.invalid`,
  };
  const publicEmail = `qa.newsletter.public.${runId}@example.invalid`;
  const audienceName = `${tag} ručna publika`;
  const csvListName = `${tag} CSV lista`;
  const xlsxListName = `${tag} XLSX lista`;
  const campaignTitle = `${tag} kampanja`;
  const templateName = `${tag} šablon`;

  let db: PrismaClient;
  let adminId: string | null = null;
  let reviewerId: string | null = null;
  let audienceId: string | null = null;
  let campaignId: string | null = null;
  const campaignIds = new Set<string>();
  const audienceIds = new Set<string>();
  const templateIds = new Set<string>();

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await cleanup();
    const passwordHashes = await Promise.all([
      bcrypt.hash(adminPassword, 12),
      bcrypt.hash(reviewerPassword, 12),
    ]);
    const [admin, reviewer] = await Promise.all([
      db.adminUser.create({
        data: {
          email: adminEmail,
          passwordHash: passwordHashes[0],
          role: "SUPER",
          enabled: true,
          firstName: "QA",
          lastName: "Newsletter",
        },
        select: { id: true },
      }),
      db.adminUser.create({
        data: {
          email: reviewerEmail,
          passwordHash: passwordHashes[1],
          role: "SUPER",
          enabled: true,
          firstName: "QA",
          lastName: "Reviewer",
        },
        select: { id: true },
      }),
    ]);
    adminId = admin.id;
    reviewerId = reviewer.id;
    for (const [index, email] of contactEmails.entries()) {
      await db.marketingContact.create({
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
      });
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

  test("admin builds an audience, versions a campaign, enforces a second approver and sends once", async ({ context, page }) => {
    await prepareContext(context);
    await login(page);

    await test.step("audience preview and save only include checked contacts", async () => {
      await page.goto("/admin/newsletter?view=audiences", { waitUntil: "domcontentloaded" });
      await page.locator('input[name="name"]').fill(audienceName);
      await page.locator('input[name="description"]').fill("Izolovana ručna QA publika.");
      await page.getByText("Ručni izbor i isključenja", { exact: true }).click();
      for (const email of contactEmails) {
        await page.getByRole("checkbox", { name: email }).check();
      }
      await page.getByRole("button", { name: "Prikaži veličinu publike" }).click();
      await acceptanceExpect(page.getByText("2 podobnih kontakata")).toBeVisible();
      await page.getByRole("button", { name: "Sačuvaj publiku" }).click();
      await acceptanceExpect(page.getByRole("status")).toContainText("Trenutno odgovara 2 kontakta");
      const audience = await db.newsletterAudience.findUniqueOrThrow({
        where: { name: audienceName },
        select: { id: true, estimatedCount: true },
      });
      audienceId = audience.id;
      audienceIds.add(audience.id);
      expect(audience.estimatedCount).toBe(2);
    });

    await test.step("campaign blocks, preview, immutable version and test send are persisted", async () => {
      await page.goto("/admin/newsletter", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "+ Nova kampanja" }).first().click();
      await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter\/kampanje\/[^/]+$/);
      campaignId = page.url().split("/").pop()!;
      campaignIds.add(campaignId);
      const editorForm = page.locator("form#newsletter-campaign-editor:visible").first();
      await acceptanceExpect(editorForm).toBeVisible();
      await editorForm.locator('input[name="title"]').fill(campaignTitle);
      await editorForm.locator('input[name="subject"]').fill(`${tag} — samo danas`);
      await editorForm.locator('input[name="previewText"]').fill("QA preview tekst");
      await editorForm.locator(`input[name="audienceIds"][value="${audienceId}"]`).check();
      await editorForm.locator('select[name="audienceMode"]').selectOption("FIXED");

      await editorForm.locator("select").filter({ has: page.locator('option[value="voucher"]') }).selectOption("voucher");
      await editorForm.getByRole("button", { name: "+ Dodaj blok" }).click();
      await editorForm.getByPlaceholder("KOD").fill("QA2026");
      await editorForm.getByPlaceholder("Uslovi ili objašnjenje").fill("Važi samo u QA proveri.");
      await acceptanceExpect(editorForm.getByText("QA2026", { exact: true })).toBeVisible();

      await editorForm.getByRole("button", { name: "Sačuvaj novu verziju" }).click();
      await acceptanceExpect.poll(async () => db.newsletterCampaignVersion.count({ where: { campaignId: campaignId! } })).toBe(2);
      await acceptanceExpect(editorForm.getByRole("status")).toContainText("Nacrt i nova verzija su sačuvani");
      await acceptanceExpect(editorForm.locator(`input[name="audienceIds"][value="${audienceId}"]`)).toBeChecked();
      await acceptanceExpect(editorForm.locator('select[name="audienceMode"]')).toHaveValue("FIXED");
      const saved = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId! }, select: { html: true } });
      expect(saved.html).toContain("QA2026");
      expect(saved.html).toContain("#123F5A");
      expect(saved.html).toContain("garantni-list-logo.jpeg");

      const testForm = page.locator("form#newsletter-campaign-test-send:visible").first();
      await testForm.locator('input[name="email"]').fill(adminEmail);
      await testForm.getByRole("button", { name: "Pošalji test" }).click();
      await acceptanceExpect.poll(async () => db.emailMessage.count({
        where: { recipient: adminEmail, kind: "newsletter_test", status: "SENT" },
      })).toBe(1);
      await acceptanceExpect.poll(async () => db.newsletterCampaign.findUnique({
        where: { id: campaignId! },
        select: { status: true },
      })).toEqual({ status: "DRAFT" });
    });

    await test.step("creator cannot approve a threshold campaign, but a second admin can", async () => {
      await page.getByRole("button", { name: "Pošalji na proveru" }).click();
      const approveButton = page.getByRole("button", { name: "Odobri kampanju" });
      await acceptanceExpect(approveButton).toBeDisabled();
      await acceptanceExpect(page.getByText(/odobrenje mora dati drugi administrator/)).toBeVisible();

      await context.clearCookies();
      await prepareContext(context);
      await login(page, reviewerEmail, reviewerPassword, `/admin/newsletter/kampanje/${campaignId}`);
      await acceptanceExpect(page.getByRole("button", { name: "Odobri kampanju" })).toBeEnabled();
      await page.getByRole("button", { name: "Odobri kampanju" }).click();
      await acceptanceExpect(page.getByRole("button", { name: "Pošalji odmah" })).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Pošalji odmah" }).click();
      await acceptanceExpect(page.getByText(/Zakazana · verzija 2/)).toBeVisible();

      const secret = process.env.BACKGROUND_JOBS_CRON_SECRET;
      if (!secret) throw new Error("Newsletter acceptance requires BACKGROUND_JOBS_CRON_SECRET.");
      await acceptanceExpect.poll(async () => {
        const response = await page.request.post("/api/cron/background-jobs?limit=25", {
          headers: { authorization: `Bearer ${secret}` },
        });
        if (!response.ok()) throw new Error(`Background worker returned ${response.status()}: ${await response.text()}`);
        return db.newsletterCampaign.findUnique({
          where: { id: campaignId! },
          select: { status: true, delivered: true, recipients: true },
        });
      }, { intervals: [500, 1_000, 2_000] }).toEqual({ status: "SENT", delivered: 2, recipients: 2 });
      await acceptanceExpect.poll(async () => db.newsletterCampaignRecipient.count({
        where: { campaignId: campaignId!, status: "DELIVERED" },
      })).toBe(2);
    });

    await test.step("all workflow mutations are audited under the correct administrators", async () => {
      const creatorActions = new Set((await db.auditLog.findMany({
        where: { actorId: adminId! }, select: { action: true },
      })).map((entry) => entry.action));
      for (const action of [
        "newsletter.audience.save",
        "newsletter.campaign.create",
        "newsletter.campaign.save",
        "newsletter.campaign.test",
        "newsletter.campaign.submitReview",
      ]) expect(creatorActions, `Missing creator audit action ${action}`).toContain(action);
      const reviewerActions = new Set((await db.auditLog.findMany({
        where: { actorId: reviewerId! }, select: { action: true },
      })).map((entry) => entry.action));
      expect(reviewerActions).toContain("newsletter.campaign.approve");
      expect(reviewerActions).toContain("newsletter.campaign.sendNow");
      expect([...creatorActions, ...reviewerActions].filter((action) => action.endsWith(".error"))).toEqual([]);
    });
  });

  test("public double opt-in, one-time confirmation and signed unsubscribe stay consent-safe", async ({ context, page }) => {
    await prepareContext(context);
    const response = await page.request.post("/api/newsletter", {
      data: { email: publicEmail, source: "qa-footer" },
    });
    expect(response.status()).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const pending = await db.marketingContact.findUniqueOrThrow({
      where: { email: publicEmail },
      select: { id: true, status: true, subscribedAt: true },
    });
    expect(pending).toMatchObject({ status: "PENDING", subscribedAt: null });
    expect(await db.marketingConsentEvent.count({
      where: { contactId: pending.id, type: "REQUESTED" },
    })).toBe(1);
    expect(await db.emailMessage.count({
      where: { recipient: publicEmail, kind: "newsletter_opt_in", status: "SENT" },
    })).toBe(1);

    const rawToken = `qa_${runId}_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`;
    await db.newsletterOptInToken.deleteMany({ where: { contactId: pending.id } });
    await db.newsletterOptInToken.create({
      data: {
        contactId: pending.id,
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await page.goto(`/newsletter/potvrdi?token=${encodeURIComponent(rawToken)}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Potvrdi prijavu" }).click();
    await acceptanceExpect(page.getByRole("heading", { name: "Newsletter prijava je potvrđena" })).toBeVisible();
    await acceptanceExpect.poll(async () => db.marketingContact.findUnique({
      where: { email: publicEmail }, select: { status: true },
    })).toEqual({ status: "ACTIVE" });

    await page.goto(`/newsletter/potvrdi?token=${encodeURIComponent(rawToken)}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Potvrdi prijavu" }).click();
    await acceptanceExpect(page.getByRole("heading", { name: "Link nije važeći" })).toBeVisible();

    const unsubscribeToken = buildEmailUnsubscribeToken({
      purpose: "newsletter",
      email: publicEmail,
      exp: Math.floor(Date.now() / 1_000) + 60,
    });
    await page.goto(`/api/email/unsubscribe/${unsubscribeToken}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Potvrdi" }).click();
    await acceptanceExpect(page.locator("body")).toContainText('"ok":true');
    await acceptanceExpect.poll(async () => db.marketingContact.findUnique({
      where: { email: publicEmail }, select: { status: true },
    })).toEqual({ status: "UNSUBSCRIBED" });
    expect(await db.newsletterSubscriber.findUnique({
      where: { email: publicEmail }, select: { consent: true },
    })).toEqual({ consent: false });

    const expiredToken = buildEmailUnsubscribeToken({
      purpose: "newsletter",
      email: publicEmail,
      exp: Math.floor(Date.now() / 1_000) - 1,
    });
    const invalidPost = await page.request.post(`/api/email/unsubscribe/${expiredToken}`);
    expect(invalidPost.status()).toBe(400);
  });

  test("CSV and XLSX imports preserve consent boundaries, tags and automatic audiences", async ({ context, page }) => {
    await db.marketingContact.create({
      data: {
        email: importEmails.unsubscribed,
        status: "UNSUBSCRIBED",
        source: "earlier-opt-out",
        unsubscribedAt: new Date(),
      },
    });
    await prepareContext(context);
    await login(page);
    await page.goto("/admin/newsletter?view=contacts", { waitUntil: "domcontentloaded" });

    const csv = [
      "email,ime,prezime,consent,datum_saglasnosti,izvor",
      `${importEmails.overlap},Ana,Preklop,da,2026-08-24,qa-csv`,
      `${importEmails.pending},Pera,Čekanje,,,qa-csv`,
      `${importEmails.unsubscribed},Uroš,Odjavljen,yes,2026-08-24,qa-csv`,
      `${importEmails.overlap},Duplikat,Kontakt,yes,2026-08-24,qa-csv`,
      "nije-email,Loš,Red,da,2026-08-24,qa-csv",
    ].join("\n");
    const previewForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Proveri bez upisa" }) });
    await previewForm.locator('input[name="contactsFile"]').setInputFiles({
      name: "qa-kontakti.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await previewForm.getByRole("button", { name: "Proveri bez upisa" }).click();
    await acceptanceExpect(previewForm.getByRole("status")).toContainText("Ispravnih: 3");
    await acceptanceExpect(previewForm.getByRole("status")).toContainText("redova sa izričitom saglasnošću: 2");
    await acceptanceExpect(previewForm.getByRole("status")).toContainText("neispravnih: 1");
    await acceptanceExpect(previewForm.getByRole("status")).toContainText("duplikata u fajlu: 1");

    const importForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Uvezi kontakte" }) });
    await fillImportForm(importForm, csvListName, "qa-kontakti.csv", "text/csv", Buffer.from(csv));
    page.once("dialog", (dialog) => dialog.accept());
    await importForm.getByRole("button", { name: "Uvezi kontakte" }).click();
    await acceptanceExpect(importForm.getByRole("status")).toContainText(`Publika „Lista — ${csvListName}” je spremna`);

    await acceptanceExpect.poll(async () => db.marketingContact.findMany({
      where: { email: { in: Object.values(importEmails) } },
      orderBy: { email: "asc" },
      select: { email: true, status: true, tags: true },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: importEmails.overlap, status: "ACTIVE", tags: [csvListName] }),
      expect.objectContaining({ email: importEmails.pending, status: "PENDING", tags: [csvListName] }),
      expect.objectContaining({ email: importEmails.unsubscribed, status: "UNSUBSCRIBED", tags: [csvListName] }),
    ]));
    const csvAudience = await db.newsletterAudience.findUniqueOrThrow({
      where: { name: `Lista — ${csvListName}` },
      select: { id: true, estimatedCount: true },
    });
    audienceIds.add(csvAudience.id);
    expect(csvAudience.estimatedCount).toBe(2);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Kontakti");
    sheet.addRows([
      ["email", "ime", "prezime", "consent", "datum_saglasnosti", "izvor"],
      [importEmails.overlap, "Ana", "Preklop", "da", new Date("2026-08-24"), "qa-xlsx"],
      [importEmails.second, "Mila", "Druga", "true", new Date("2026-08-24"), "qa-xlsx"],
      [importEmails.pending, "Pera", "Čekanje", "", "", "qa-xlsx"],
    ]);
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await fillImportForm(importForm, xlsxListName, "qa-kontakti.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBuffer);
    page.once("dialog", (dialog) => dialog.accept());
    await importForm.getByRole("button", { name: "Uvezi kontakte" }).click();
    await acceptanceExpect(importForm.getByRole("status")).toContainText(`Publika „Lista — ${xlsxListName}” je spremna`);

    const overlap = await db.marketingContact.findUniqueOrThrow({
      where: { email: importEmails.overlap }, select: { tags: true },
    });
    expect(overlap.tags).toEqual(expect.arrayContaining([csvListName, xlsxListName]));
    const xlsxAudience = await db.newsletterAudience.findUniqueOrThrow({
      where: { name: `Lista — ${xlsxListName}` },
      select: { id: true, estimatedCount: true },
    });
    audienceIds.add(xlsxAudience.id);
    expect(xlsxAudience.estimatedCount).toBe(3);

    await page.goto(`/admin/newsletter?view=contacts&q=${encodeURIComponent(importEmails.overlap)}`, { waitUntil: "domcontentloaded" });
    const contactRow = page.getByText(importEmails.overlap, { exact: true }).locator("xpath=ancestor::tr");
    await acceptanceExpect(contactRow).toContainText(csvListName);
    await acceptanceExpect(contactRow).toContainText(xlsxListName);
  });

  test("an explicit warning allows pending contacts from multiple audiences without changing consent", async ({ context, page }) => {
    await prepareContext(context);
    await login(page);
    const csvAudience = await db.newsletterAudience.findUniqueOrThrow({ where: { name: `Lista — ${csvListName}` } });
    const xlsxAudience = await db.newsletterAudience.findUniqueOrThrow({ where: { name: `Lista — ${xlsxListName}` } });

    await page.goto("/admin/newsletter", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ Nova kampanja" }).first().click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter\/kampanje\/[^/]+$/);
    const overrideCampaignId = page.url().split("/").pop()!;
    campaignIds.add(overrideCampaignId);
    const editor = page.locator("form#newsletter-campaign-editor:visible").first();
    await editor.locator('input[name="title"]').fill(`${tag} publika bez saglasnosti`);
    await editor.locator('input[name="subject"]').fill(`${tag} upozorenje`);
    await editor.locator(`input[name="audienceIds"][value="${csvAudience.id}"]`).check();
    await editor.locator(`input[name="audienceIds"][value="${xlsxAudience.id}"]`).check();
    await editor.locator('input[name="includeContactsWithoutConsent"]').check();
    await editor.getByRole("button", { name: "Sačuvaj novu verziju" }).click();
    await acceptanceExpect(editor.getByRole("status")).toContainText("Nacrt i nova verzija su sačuvani");
    await acceptanceExpect(
      page.locator('main [role="alert"]').filter({
        hasText: "može uključiti kontakte bez zabeležene saglasnosti",
      }),
    ).toBeVisible();

    await acceptanceExpect.poll(async () => db.newsletterCampaign.findUnique({
      where: { id: overrideCampaignId },
      select: {
        includeContactsWithoutConsent: true,
        versions: { orderBy: { version: "desc" }, take: 1, select: { includeContactsWithoutConsent: true } },
      },
    })).toEqual({
      includeContactsWithoutConsent: true,
      versions: [{ includeContactsWithoutConsent: true }],
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Pošalji na proveru" }).click();
    await acceptanceExpect.poll(async () => db.newsletterCampaign.findUnique({
      where: { id: overrideCampaignId },
      select: { recipients: true, status: true, audienceBreakdown: true },
    })).toMatchObject({
      recipients: 3,
      status: "IN_REVIEW",
      audienceBreakdown: { matchedWithoutConsent: 1 },
    });

    await context.clearCookies();
    await prepareContext(context);
    await login(page, reviewerEmail, reviewerPassword, `/admin/newsletter/kampanje/${overrideCampaignId}`);
    await page.getByRole("button", { name: "Odobri kampanju" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Pošalji odmah" }).click();
    await acceptanceExpect.poll(async () => db.newsletterCampaign.findUnique({
      where: { id: overrideCampaignId }, select: { status: true },
    })).toEqual({ status: "SCHEDULED" });

    await expect(sendNewsletterCampaign(overrideCampaignId)).resolves.toMatchObject({
      ok: true,
      simulated: true,
      recipients: 3,
    });
    await expect(db.newsletterCampaign.findUnique({
      where: { id: overrideCampaignId }, select: { status: true, delivered: true },
    })).resolves.toEqual({ status: "SENT", delivered: 3 });
    await expect(db.newsletterCampaignRecipient.findUnique({
      where: {
        campaignId_email: { campaignId: overrideCampaignId, email: importEmails.pending },
      },
      select: { status: true, consentStatusAtSelection: true },
    })).resolves.toEqual({ status: "DELIVERED", consentStatusAtSelection: "PENDING" });
    await expect(db.marketingContact.findUnique({
      where: { email: importEmails.pending }, select: { status: true },
    })).resolves.toEqual({ status: "PENDING" });
  });

  test("multiple audiences deduplicate recipients; cancel, duplicate, template and deletion flows are safe", async ({ context, page }) => {
    await prepareContext(context);
    await login(page);
    const csvAudience = await db.newsletterAudience.findUniqueOrThrow({ where: { name: `Lista — ${csvListName}` } });
    const xlsxAudience = await db.newsletterAudience.findUniqueOrThrow({ where: { name: `Lista — ${xlsxListName}` } });

    await page.goto("/admin/newsletter", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ Nova kampanja" }).first().click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter\/kampanje\/[^/]+$/);
    const multiCampaignId = page.url().split("/").pop()!;
    campaignIds.add(multiCampaignId);
    let editor = page.locator("form#newsletter-campaign-editor:visible").first();
    await editor.locator('input[name="title"]').fill(`${tag} više publika`);
    await editor.locator('input[name="subject"]').fill(`${tag} deduplikacija`);
    await editor.locator(`input[name="audienceIds"][value="${csvAudience.id}"]`).check();
    await editor.locator(`input[name="audienceIds"][value="${xlsxAudience.id}"]`).check();
    await editor.getByRole("button", { name: "Sačuvaj novu verziju" }).click();
    await acceptanceExpect(editor.getByRole("status")).toContainText("Nacrt i nova verzija su sačuvani");
    await page.getByRole("button", { name: "Pošalji na proveru" }).click();
    await acceptanceExpect.poll(async () => db.newsletterCampaign.findUnique({
      where: { id: multiCampaignId }, select: { recipients: true, status: true },
    })).toEqual({ recipients: 2, status: "IN_REVIEW" });

    await context.clearCookies();
    await prepareContext(context);
    await login(page, reviewerEmail, reviewerPassword, `/admin/newsletter/kampanje/${multiCampaignId}`);
    await page.getByRole("button", { name: "Odobri kampanju" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Pošalji odmah" }).click();
    await acceptanceExpect(page.getByText(/Zakazana · verzija 2/)).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Otkaži" }).click();
    await acceptanceExpect(page.getByText(/Otkazana · verzija 2/)).toBeVisible();
    await acceptanceExpect.poll(async () => db.backgroundJob.findUnique({
      where: { idempotencyKey: `newsletter-send:${multiCampaignId}` },
      select: { status: true, completedAt: true, lastError: true },
    })).toMatchObject({ status: "COMPLETED", lastError: "campaign_cancelled", completedAt: expect.any(Date) });

    await page.getByRole("button", { name: "Napravi kopiju" }).click();
    await acceptanceExpect.poll(() => page.url().split("/").pop()).not.toBe(multiCampaignId);
    const duplicateId = page.url().split("/").pop()!;
    campaignIds.add(duplicateId);
    editor = page.locator("form#newsletter-campaign-editor:visible").first();
    await acceptanceExpect(editor.locator(`input[name="audienceIds"][value="${csvAudience.id}"]`)).toBeChecked();
    await acceptanceExpect(editor.locator(`input[name="audienceIds"][value="${xlsxAudience.id}"]`)).toBeChecked();
    await page.locator('input[name="name"]').fill(templateName);
    await page.getByRole("button", { name: "Sačuvaj šablon" }).click();
    await acceptanceExpect(page.getByRole("status")).toContainText("Šablon je sačuvan");
    const template = await db.newsletterTemplate.findUniqueOrThrow({ where: { name: templateName } });
    templateIds.add(template.id);

    await page.goto("/admin/newsletter?view=templates", { waitUntil: "domcontentloaded" });
    const templateForm = page.locator(`form:has(input[name="templateId"][value="${template.id}"])`);
    await templateForm.getByRole("button", { name: "Nova kampanja" }).click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter\/kampanje\/[^/]+$/);
    const fromTemplateId = page.url().split("/").pop()!;
    campaignIds.add(fromTemplateId);
    await acceptanceExpect(page.locator('input[name="subject"]')).toHaveValue(`${tag} deduplikacija`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Obriši nacrt" }).click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter$/);

    await page.goto(`/admin/newsletter/kampanje/${duplicateId}`, { waitUntil: "domcontentloaded" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Obriši nacrt" }).click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter$/);

    await page.goto("/admin/newsletter?view=templates", { waitUntil: "domcontentloaded" });
    const deleteTemplateForm = page.locator(`form:has(input[name="id"][value="${template.id}"])`);
    page.once("dialog", (dialog) => dialog.accept());
    await deleteTemplateForm.getByRole("button", { name: "Obriši" }).click();
    await acceptanceExpect.poll(async () => db.newsletterTemplate.findUnique({ where: { id: template.id } })).toBeNull();

    await page.goto("/admin/newsletter?view=audiences", { waitUntil: "domcontentloaded" });
    const usedAudienceDelete = page.locator(`form:has(input[name="id"][value="${csvAudience.id}"])`);
    page.once("dialog", (dialog) => dialog.accept());
    await usedAudienceDelete.getByRole("button", { name: "Obriši" }).click();
    await acceptanceExpect(usedAudienceDelete.getByRole("alert")).toContainText("ne može da se obriše");
  });

  test("invalid draft cannot enter review and an unused audience can be removed", async ({ context, page }) => {
    await prepareContext(context);
    await login(page);
    await page.goto("/admin/newsletter", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ Nova kampanja" }).first().click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter\/kampanje\/[^/]+$/);
    const invalidCampaignId = page.url().split("/").pop()!;
    campaignIds.add(invalidCampaignId);
    await page.getByRole("button", { name: "Pošalji na proveru" }).click();
    await acceptanceExpect(page.getByText("Izaberite bar jednu publiku kampanje.", { exact: true })).toBeVisible();
    expect(await db.newsletterCampaign.findUnique({
      where: { id: invalidCampaignId }, select: { status: true },
    })).toEqual({ status: "DRAFT" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Obriši nacrt" }).click();
    await acceptanceExpect(page).toHaveURL(/\/admin\/newsletter$/);

    await page.goto("/admin/newsletter?view=audiences", { waitUntil: "domcontentloaded" });
    const unusedName = `${tag} privremena publika`;
    await page.locator('input[name="name"]').fill(unusedName);
    await page.getByRole("button", { name: "Sačuvaj publiku" }).click();
    await acceptanceExpect(page.getByRole("status")).toContainText("Publika je sačuvana");
    const unused = await db.newsletterAudience.findUniqueOrThrow({ where: { name: unusedName } });
    audienceIds.add(unused.id);
    await page.goto(`/admin/newsletter?view=audiences&audienceId=${unused.id}`, { waitUntil: "domcontentloaded" });
    const deleteForm = page.locator(`form:has(input[name="id"][value="${unused.id}"])`);
    page.once("dialog", (dialog) => dialog.accept());
    await deleteForm.getByRole("button", { name: "Obriši" }).click();
    await acceptanceExpect.poll(async () => db.newsletterAudience.findUnique({ where: { id: unused.id } })).toBeNull();
  });

  async function login(
    page: Page,
    email = adminEmail,
    password = adminPassword,
    callbackUrl = "/admin/newsletter",
  ) {
    await page.goto(`/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("E-pošta").fill(email);
    await page.getByLabel("Lozinka").fill(password);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await acceptanceExpect(page).toHaveURL(new RegExp(callbackUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  async function prepareContext(context: BrowserContext) {
    await context.addCookies([{
      name: "spc_cookie_consent",
      value: "essential",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3018",
    }]);
  }

  async function fillImportForm(
    form: ReturnType<Page["locator"]>,
    listName: string,
    fileName: string,
    mimeType: string,
    buffer: Buffer,
  ) {
    await form.locator('input[name="listName"]').fill(listName);
    await form.locator('input[name="contactsFile"]').setInputFiles({ name: fileName, mimeType, buffer });
  }

  async function cleanup() {
    if (!db) return;
    const campaigns = await db.newsletterCampaign.findMany({
      where: { OR: [{ title: { startsWith: tag } }, { id: { in: [...campaignIds] } }] },
      select: { id: true },
    }).catch(() => []);
    const ids = Array.from(new Set([
      ...campaigns.map((campaign) => campaign.id),
      ...campaignIds,
      ...(campaignId ? [campaignId] : []),
    ]));
    if (ids.length) {
      await db.backgroundJob.deleteMany({
        where: { OR: ids.map((id) => ({ idempotencyKey: `newsletter-send:${id}` })) },
      });
      await db.newsletterCampaign.deleteMany({ where: { id: { in: ids } } });
    }
    await db.newsletterTemplate.deleteMany({
      where: { OR: [{ name: { startsWith: tag } }, { id: { in: [...templateIds] } }] },
    }).catch(() => undefined);
    await db.newsletterAudience.deleteMany({
      where: { OR: [{ name: { contains: tag } }, { id: { in: [...audienceIds] } }] },
    }).catch(() => undefined);
    const emails = [...contactEmails, ...Object.values(importEmails), publicEmail];
    await db.newsletterSubscriber.deleteMany({ where: { email: { in: emails } } }).catch(() => undefined);
    await db.marketingContact.deleteMany({ where: { email: { in: emails } } }).catch(() => undefined);
    await db.emailMessage.deleteMany({
      where: { recipient: { in: [adminEmail, reviewerEmail, publicEmail] } },
    }).catch(() => undefined);
    await db.backgroundJob.deleteMany({
      where: { idempotencyKey: { contains: publicEmail } },
    }).catch(() => undefined);
    for (const id of [adminId, reviewerId].filter((value): value is string => Boolean(value))) {
      await db.auditLog.deleteMany({ where: { actorId: id } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { OR: [adminEmail, reviewerEmail, publicEmail].map((email) => ({ key: { contains: email } })) },
    });
    await db.adminUser.deleteMany({ where: { email: { in: [adminEmail, reviewerEmail] } } });
    adminId = null;
    reviewerId = null;
    audienceId = null;
    campaignId = null;
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
