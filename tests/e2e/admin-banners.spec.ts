import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("admin banner manager", () => {
  test.skip(
    process.env.E2E_BANNERS !== "1",
    "Set E2E_BANNERS=1 to run the read-only banner UI acceptance test.",
  );

  test.setTimeout(120_000);

  const runId = `${Date.now()}-${process.pid}`;
  const adminEmail = `qa.banners.${runId}@example.invalid`;
  const adminPassword = `QaBanners!${runId}x`;
  let db: PrismaClient;
  let adminId = "";
  let bannerSnapshot = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    bannerSnapshot = await serializeBanners(db);
    const admin = await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Baneri",
      },
      select: { id: true },
    });
    adminId = admin.id;
  });

  test.afterAll(async () => {
    try {
      expect(await serializeBanners(db)).toBe(bannerSnapshot);
    } finally {
      if (adminId) {
        await db.auditLog.deleteMany({ where: { actorId: adminId } });
      }
      await db.rateLimitBucket.deleteMany({
        where: { key: { contains: adminEmail } },
      });
      await db.adminUser.deleteMany({ where: { email: adminEmail } });
      await db.$disconnect();
    }
  });

  test("shows every live fallback and accepts drag-and-drop files without URL fields", async ({
    context,
    page,
  }, testInfo) => {
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url:
          process.env.PLAYWRIGHT_BASE_URL ??
          `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
      },
    ]);
    await login(page);
    await page.goto("/admin/baneri", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Baneri", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("3 slajdova · 3 aktivnih sada")).toBeVisible();
    await expect(
      page.getByText("1 banera · 1 aktivnih sada"),
    ).toHaveCount(2);

    for (const title of [
      "Izdvojena ponuda",
      "Heroji meseca",
      "Ponuda na jednom mestu",
      "Niske cene pod trajnom zaštitom",
      "Novo u ponudi",
    ]) {
      await expect(
        page.locator("article").filter({
          has: page.getByText(title, { exact: true }),
        }),
      ).toHaveCount(1);
    }

    await expect(page.getByText("ugrađeni sadržaj")).toHaveCount(5);
    await expect(page.locator('img[alt^="Desktop:"]')).toHaveCount(5);
    await expect(page.locator('img[alt^="Mobilna:"]')).toHaveCount(3);
    await expect(page.getByLabel("Slika (desktop URL)")).toHaveCount(0);
    await expect(page.getByLabel("Slika (mobilna URL)")).toHaveCount(0);
    await page.screenshot({
      path: `test-results/admin-banners-${testInfo.project.name}.png`,
      fullPage: true,
    });

    const newHeroForm = page
      .locator("form")
      .filter({
        has: page.locator(
          'input[name="placement"][value="HERO"]',
        ),
        hasNot: page.locator('input[name="id"]'),
      })
      .filter({ has: page.locator('input[name="title"]') });
    await expect(newHeroForm).toHaveCount(1);

    const desktopInput = newHeroForm.locator(
      'input[name="imageDesktopFile"]',
    );
    await dropFile(desktopInput, "qa-hero.jpg");
    await expect(
      newHeroForm.getByText("qa-hero.jpg", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        desktopInput.evaluate(
          (element) => (element as HTMLInputElement).files?.[0]?.name ?? "",
        ),
      )
      .toBe("qa-hero.jpg");

    await newHeroForm
      .locator('input[name="imageMobileFile"]')
      .setInputFiles(path.resolve("public/logo.jpeg"));
    await expect(
      newHeroForm.getByText("logo.jpeg", { exact: true }),
    ).toBeVisible();
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin%2Fbaneri", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/baneri$/, { timeout: 15_000 });
  }
});

async function dropFile(input: Locator, name: string) {
  const base64 = readFileSync(path.resolve("public/logo.jpeg")).toString(
    "base64",
  );
  await input.evaluate(
    (element, payload) => {
      const bytes = Uint8Array.from(atob(payload.base64), (character) =>
        character.charCodeAt(0),
      );
      const file = new File([bytes], payload.name, { type: "image/jpeg" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const label = (element as HTMLInputElement).labels?.[0];
      if (!label) throw new Error("Drop label is missing.");
      label.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    },
    { base64, name },
  );
}

async function serializeBanners(db: PrismaClient) {
  const banners = await db.banner.findMany({ orderBy: { id: "asc" } });
  return JSON.stringify(banners);
}

function createDatabaseClient() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
  if (!raw) throw new Error("Database URL is required for banner acceptance.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
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
