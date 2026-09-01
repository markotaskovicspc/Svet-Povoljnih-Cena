import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import {
  formatBelgradePricingDateTime,
  parseBelgradePricingDateTime,
} from "@/lib/admin/pricing-date-time";
import { requireSafeE2EDatabase } from "../helpers/e2e-database-safety";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("Admin period akcije → javni prikaz", () => {
  test.skip(
    process.env.E2E_ACTION_PERIOD_ADMIN_FLOW !== "1",
    "Set E2E_ACTION_PERIOD_ADMIN_FLOW=1 and run against an isolated E2E schema.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const adminEmail = `qa.action.period.${runId}@example.invalid`;
  const adminPassword = `QaActionPeriod!${runId}`;
  const actionName = `QA period akcije ${runId}`;
  const actionSlug = `qa-period-akcije-${runId}`;
  const productSlug = `qa-period-artikal-${runId}`;
  const productSku = `QA-PERIOD-${runId}`.slice(0, 80);
  const categorySlug = `qa-period-category-${runId}`;
  const groupSlug = `qa-period-group-${runId}`;
  const priceListCode = `QA-PERIOD-${runId}`.slice(0, 60);

  const today = formatBelgradePricingDateTime(new Date()).slice(0, 10);
  const initialStart = `${shiftDateOnly(today, -1)}T00:01`;
  const initialEnd = `${shiftDateOnly(today, 2)}T23:59`;
  const editedStart = `${today}T00:01`;
  const editedEnd = `${shiftDateOnly(today, 1)}T23:59`;

  let db: PrismaClient;

  test.beforeAll(async () => {
    const databaseUrl = requireSafeE2EDatabase();
    if (!databaseUrl) {
      throw new Error("An isolated E2E database URL is required.");
    }

    const parsedDatabaseUrl = new URL(databaseUrl);
    const schema = parsedDatabaseUrl.searchParams.get("schema")?.trim();
    if (!schema || !/^client_feedback_e2e_[a-z0-9_]+$/.test(schema)) {
      throw new Error(
        "The action-period E2E test must use a client_feedback_e2e_* schema.",
      );
    }
    parsedDatabaseUrl.searchParams.delete("schema");

    db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: parsedDatabaseUrl.toString() },
        { schema },
      ),
    });

    const [connection] = await db.$queryRaw<Array<{ schema: string }>>`
      SELECT current_schema() AS schema
    `;
    if (connection?.schema !== schema) {
      throw new Error(
        `Refusing to seed schema ${connection?.schema ?? "unknown"}; expected ${schema}.`,
      );
    }

    const [passwordHash, group, parentCategory] = await Promise.all([
      bcrypt.hash(adminPassword, 12),
      db.group.create({
        data: { name: `QA period grupa ${runId}`, slug: groupSlug },
      }),
      db.category.create({
        data: {
          name: `QA period kategorija ${runId}`,
          slug: categorySlug,
          path: `/${categorySlug}`,
          level: 0,
        },
      }),
    ]);

    await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: "QA",
        lastName: "Period akcije",
        role: "SUPER",
        enabled: true,
      },
    });

    const childCategory = await db.category.create({
      data: {
        name: `QA period podkategorija ${runId}`,
        slug: `${categorySlug}-child`,
        path: `/${categorySlug}/${categorySlug}-child`,
        level: 1,
        parentId: parentCategory.id,
      },
    });
    const action = await db.action.create({
      data: {
        name: actionName,
        slug: actionSlug,
        kind: "AKCIJA",
        startsAt: parseBelgradePricingDateTime(initialStart),
        endsAt: parseBelgradePricingDateTime(initialEnd),
        priority: 2_000_000_000,
      },
    });
    const product = await db.product.create({
      data: {
        sku: productSku,
        slug: productSlug,
        name: `QA artikal perioda ${runId}`,
        description: "Privremeni artikal za proveru perioda akcije.",
        fullPrice: 1_000,
        stock: 5,
        dcAvailableQty: 5,
        groupId: group.id,
        categories: { create: { categoryId: childCategory.id } },
        media: {
          create: {
            kind: "IMAGE",
            url: "/logo.jpeg",
            alt: "QA artikal perioda akcije",
          },
        },
      },
    });
    await Promise.all([
      db.actionProduct.create({
        data: {
          actionId: action.id,
          productId: product.id,
          salePrice: 700,
        },
      }),
      db.priceList.create({
        data: {
          code: priceListCode,
          name: `${priceListCode} *MP`,
          kind: "RETAIL",
          currency: "RSD",
          active: true,
          validFrom: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          entries: {
            create: {
              productId: product.id,
              price: 1_000,
              validFrom: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            },
          },
        },
      }),
    ]);
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("izmena u admin formi odmah menja listing i PDP", async ({
    context,
    page,
  }) => {
    await login(page);

    const form = page
      .locator("form")
      .filter({ has: page.locator('input[name="slug"]') })
      .first();
    await expect(form.locator('input[name="startsAt"]')).toHaveValue(
      initialStart,
    );
    await expect(form.locator('input[name="endsAt"]')).toHaveValue(initialEnd);

    const storefront = await context.newPage();
    await storefront.goto("/akcija", { waitUntil: "domcontentloaded" });
    await expect(storefront.getByText(periodText(initialStart, initialEnd))).toBeVisible();

    await form.locator('input[name="startsAt"]').fill(editedStart);
    await form.locator('input[name="endsAt"]').fill(editedEnd);
    await form.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(
      page.getByText("Akcija je izmenjena.", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => {
        const saved = await db.action.findUniqueOrThrow({
          where: { slug: actionSlug },
          select: { startsAt: true, endsAt: true },
        });
        return {
          startsAt: formatBelgradePricingDateTime(saved.startsAt),
          endsAt: formatBelgradePricingDateTime(saved.endsAt),
        };
      })
      .toEqual({ startsAt: editedStart, endsAt: editedEnd });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(form.locator('input[name="startsAt"]')).toHaveValue(
      editedStart,
    );
    await expect(form.locator('input[name="endsAt"]')).toHaveValue(editedEnd);

    await storefront.reload({ waitUntil: "domcontentloaded" });
    await expect(storefront.getByText(periodText(editedStart, editedEnd))).toBeVisible({
      timeout: 30_000,
    });
    await expect(storefront.getByText(periodText(initialStart, initialEnd))).toHaveCount(0);

    await storefront.goto(`/p/${productSlug}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      storefront.getByText(
        `Akcijska cena važi od ${displayDate(editedStart)} do ${displayDate(editedEnd)}`,
      ),
    ).toBeVisible();

    await storefront.setViewportSize({ width: 390, height: 844 });
    await expect(
      storefront.getByText(
        `Važi od ${displayDate(editedStart).replace(/\d{4}\.$/, "")} do ${displayDate(editedEnd)}`,
      ),
    ).toBeVisible();
  });

  async function login(page: Page) {
    await page.goto("/admin/erp/akcije", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/prijava/);
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin\/erp\/akcije$/, {
      timeout: 60_000,
    });
  }
});

function shiftDateOnly(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayDate(value: string) {
  const [date] = value.split("T");
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}.`;
}

function periodText(startsAt: string, endsAt: string) {
  return `Akcijska ponuda važi od ${displayDate(startsAt)} do ${displayDate(endsAt)}`;
}
