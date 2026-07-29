// Acceptance: CONTENT-10
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type MobileTab } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("mobile shortcut CMS acceptance", () => {
  test.skip(
    process.env.E2E_MOBILE_SHORTCUTS !== "1",
    "Set E2E_MOBILE_SHORTCUTS=1 to run the isolated mobile-shortcut suite.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    email: `qa.mobile-shortcuts.${runId}@example.invalid`,
    password: `QaMobile!${runId}x`,
    slug: `qa-mobilna-ponuda-${runId}`,
    title: `QA mobilna ponuda ${runId}`,
    label: `QA prečac ${runId}`,
  };
  let db: PrismaClient;
  let supabase: SupabaseClient;
  let adminId: string | null = null;
  let originalTabs: MobileTab[] = [];
  const uploadedKeys = new Set<string>();

  test.beforeAll(async () => {
    db = createDatabaseClient();
    supabase = createStorageClient();
    originalTabs = await db.mobileTab.findMany({ orderBy: { position: "asc" } });
    expect(originalTabs).toHaveLength(4);

    const passwordHash = await bcrypt.hash(fixture.password, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.email,
        passwordHash,
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Mobilni prečaci",
      },
      select: { id: true },
    });
    adminId = admin.id;
    await db.landingPage.create({
      data: {
        slug: fixture.slug,
        title: fixture.title,
        lead: "Privremena javna landing strana za browser QA.",
        seoTitle: fixture.title,
        status: "PUBLISHED",
        publishedAt: new Date(),
        sections: {
          create: {
            position: 1,
            title: "QA sadržaj",
            body: "<p>Odredište mobilnog prečaca je uspešno otvoreno.</p>",
            productSkus: [],
          },
        },
      },
    });
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      for (const original of originalTabs) {
        await db.mobileTab.upsert({
          where: { position: original.position },
          create: original,
          update: {
            label: original.label,
            icon: original.icon,
            enabled: original.enabled,
            actionId: original.actionId,
            landingPageId: original.landingPageId,
            href: original.href,
          },
        });
      }
      await db.landingPage.deleteMany({ where: { slug: fixture.slug } });
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({
        where: { key: { contains: fixture.email } },
      });
      await db.adminUser.deleteMany({ where: { email: fixture.email } });
      if (uploadedKeys.size) {
        await supabase.storage
          .from(productMediaBucket())
          .remove([...uploadedKeys]);
      }
    } finally {
      await db.$disconnect();
    }
  });

  test("admin validates, saves, uploads, hides and reorders the four mobile boxes", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3014",
      },
    ]);
    await login(page);
    await page.goto("/admin/erp/mobilni-tabovi", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Mobilni prečaci" })).toBeVisible();
    await expect(page.locator('[id^="mobile-shortcut-"]')).toHaveCount(4);

    let editor = page.locator("#mobile-shortcut-4");
    await editor.getByLabel("Prilagođeni link (opciono)").fill("/k/qa-ne-postoji");
    await editor.getByRole("button", { name: "Sačuvaj poziciju" }).click();
    await expect(editor.getByRole("alert")).toContainText(
      "Izabrana kategorija ne postoji",
    );

    await editor.getByLabel("Naziv u boksu").fill(fixture.label);
    await editor.getByLabel("Prilagođeni link (opciono)").fill("");
    await editor
      .getByLabel("Odredište iz sistema")
      .selectOption({ label: `${fixture.title} (PUBLISHED)` });
    await editor
      .getByLabel("Nova ikona")
      .setInputFiles(path.join(process.cwd(), "public/brand/heroji-meseca.png"));
    await editor.getByRole("button", { name: "Sačuvaj poziciju" }).click();
    await expect(editor.getByRole("status")).toContainText("Pozicija 4 je sačuvana");

    await expect
      .poll(() =>
        db.mobileTab.findUnique({
          where: { position: 4 },
          select: {
            id: true,
            label: true,
            icon: true,
            enabled: true,
            actionId: true,
            landingPageId: true,
            href: true,
          },
        }),
      )
      .toMatchObject({
        label: fixture.label,
        enabled: true,
        actionId: null,
        href: null,
      });
    const savedRow = await db.mobileTab.findUniqueOrThrow({
      where: { position: 4 },
      select: { icon: true, landingPageId: true },
    });
    expect(savedRow.landingPageId).not.toBeNull();
    expect(savedRow.icon).toContain("/mobile-shortcuts/");
    const uploadedKey = storageKey(savedRow.icon);
    if (uploadedKey) uploadedKeys.add(uploadedKey);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const mobileTile = page.getByRole("link", { name: new RegExp(fixture.label) });
    await expect(mobileTile).toBeVisible();
    await expect(mobileTile).toHaveAttribute("href", `/ponuda/${fixture.slug}`);
    await mobileTile.click();
    await expect(page).toHaveURL(new RegExp(`/ponuda/${fixture.slug}$`));
    await expect(page.getByRole("heading", { name: fixture.title })).toBeVisible();
    await expect(page.getByText("Odredište mobilnog prečaca je uspešno otvoreno.")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: new RegExp(fixture.label) })).toBeHidden();

    await page.goto("/admin/erp/mobilni-tabovi", {
      waitUntil: "domcontentloaded",
    });
    editor = page.locator("#mobile-shortcut-4");
    await editor
      .getByRole("checkbox", { name: "Prikaži ovaj boks na mobilnoj početnoj" })
      .uncheck();
    await editor.getByRole("button", { name: "Sačuvaj poziciju" }).click();
    await expect(editor.getByRole("status")).toContainText("Pozicija 4 je sačuvana");
    await expect
      .poll(() => db.mobileTab.findUnique({ where: { position: 4 } }))
      .toMatchObject({ enabled: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(fixture.label, { exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin/erp/mobilni-tabovi", {
      waitUntil: "domcontentloaded",
    });
    editor = page.locator("#mobile-shortcut-4");
    await editor
      .getByRole("checkbox", { name: "Prikaži ovaj boks na mobilnoj početnoj" })
      .check();
    await editor.getByRole("button", { name: "Sačuvaj poziciju" }).click();
    await expect(editor.getByRole("status")).toContainText("Pozicija 4 je sačuvana");
    await editor.getByRole("button", { name: "Pomeri ulevo" }).click();
    await expect
      .poll(() =>
        db.mobileTab.findUnique({
          where: { position: 3 },
          select: { label: true },
        }),
      )
      .toEqual({ label: fixture.label });

    const auditActions = new Set(
      (
        await db.auditLog.findMany({
          where: { actorId: adminId! },
          select: { action: true },
        })
      ).map((entry) => entry.action),
    );
    expect(auditActions).toContain("mobileShortcut.save");
    expect(auditActions).toContain("mobileShortcut.move");
    expect(auditActions).toContain("mobileShortcut.save.error");
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(fixture.email);
    await page.getByLabel("Lozinka").fill(fixture.password);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 90_000 });
  }
});

function createDatabaseClient() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for mobile shortcut QA.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set("sslmode", process.env.DATABASE_SSLMODE?.trim() || "no-verify");
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}

function createStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase storage access is required.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function productMediaBucket() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET?.trim() ||
    process.env.SUPABASE_STORAGE_BUCKET?.trim() ||
    "product-media"
  );
}

function storageKey(iconUrl: string | null) {
  if (!iconUrl) return null;
  const marker = `/storage/v1/object/public/${productMediaBucket()}/`;
  const index = iconUrl.indexOf(marker);
  return index >= 0 ? decodeURIComponent(iconUrl.slice(index + marker.length)) : null;
}
