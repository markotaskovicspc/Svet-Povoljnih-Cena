import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type ContentPage } from "@prisma/client";
import bcrypt from "bcryptjs";

test.describe("functional public page CMS acceptance", () => {
  test.skip(
    process.env.E2E_CMS_FUNCTIONAL_PAGES !== "1",
    "Set E2E_CMS_FUNCTIONAL_PAGES=1 with an isolated E2E_DATABASE_URL.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const adminEmail = `qa.functional-content.${runId}@example.invalid`;
  const adminPassword = `QaFunctional!${runId}x`;
  const editedTitle = `QA kontakt ${runId}`;
  const editedBody = `QA CMS sadržaj ${runId}`;
  const editedEmailLabel = `QA e-pošta ${runId}`;
  const editedEmail = `qa-${runId}@example.com`;
  const editedEmailNote = `QA napomena kontakt kartice ${runId}`;
  let db: PrismaClient;
  let adminId = "";
  let original: ContentPage;

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "CONTENT",
        enabled: true,
        firstName: "QA",
        lastName: "Functional Content",
      },
      select: { id: true },
    });
    adminId = admin.id;
    original = await db.contentPage.findUniqueOrThrow({
      where: { slug: "kontakt" },
    });
  });

  test.afterAll(async () => {
    if (!db) return;
    if (original) {
      await db.contentPage.update({
        where: { id: original.id },
        data: {
          systemKey: original.systemKey,
          kind: original.kind,
          template: original.template,
          eyebrow: original.eyebrow,
          heroNote: original.heroNote,
          title: original.title,
          lead: original.lead,
          bodyMarkdown: original.bodyMarkdown,
          seoTitle: original.seoTitle,
          seoDescription: original.seoDescription,
          widgetData:
            original.widgetData === null
              ? Prisma.DbNull
              : (original.widgetData as Prisma.InputJsonValue),
          footerVisible: original.footerVisible,
          footerLabel: original.footerLabel,
          footerColumn: original.footerColumn,
          footerOrder: original.footerOrder,
          published: original.published,
          draftRevisionId: original.draftRevisionId,
          publishedRevisionId: original.publishedRevisionId,
          archivedAt: original.archivedAt,
        },
      });
      await db.contentPageRevision.deleteMany({
        where: { pageId: original.id, createdById: adminId },
      });
    }
    if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
    await db.$disconnect();
  });

  test("CONTENT admin edits and publishes functional copy without removing its widget", async ({
    page,
  }) => {
    await login(page);

    for (const slug of [
      "kontakt",
      "servis",
      "komentari",
      "podesavanja-kolacica",
    ]) {
      const row = page.getByRole("row").filter({ hasText: `/${slug}` });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("link", { name: "Izmeni" })).toBeVisible();
    }

    const contactRow = page.getByRole("row").filter({ hasText: "/kontakt" });
    await contactRow.getByRole("link", { name: "Izmeni" }).click();
    await expect(page).toHaveURL(/\/admin\/sadrzaj\/[^/?#]+$/);
    await expect(page.getByText("Uređujete tekst i SEO funkcionalne stranice.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Arhiviraj stranicu" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Kontakt kartice" }),
    ).toBeVisible();

    await page.getByLabel("Naslov", { exact: true }).fill(editedTitle);
    await page.locator('textarea[name="bodyMarkdown"]').fill(editedBody);
    await page.locator('input[name="contact-email-label"]').fill(editedEmailLabel);
    await page.locator('input[name="contact-email-value"]').fill(editedEmail);
    await page.locator('textarea[name="contact-email-note"]').fill(editedEmailNote);
    await page.getByRole("button", { name: "Sačuvaj nacrt" }).click();
    await expect(page.getByText("Nacrt je sačuvan.")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Objavi", exact: true }).click();
    await expect(page.getByText("Stranica je objavljena.")).toBeVisible();

    await page.goto("/kontakt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: editedTitle })).toBeVisible();
    await expect(page.getByText(editedBody, { exact: true })).toBeVisible();
    await expect(page.getByText(editedEmailLabel, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: editedEmail })).toHaveAttribute(
      "href",
      `mailto:${editedEmail}`,
    );
    await expect(page.getByText(editedEmailNote, { exact: true })).toBeVisible();
    await expect(page.getByText("Sedište trgovca", { exact: true })).toBeVisible();
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin%2Fsadrzaj", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/sadrzaj$/, { timeout: 90_000 });
  }
});

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for functional CMS acceptance.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
