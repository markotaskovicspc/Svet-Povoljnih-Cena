import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AdminRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const cases = [
  { role: "SUPER", allowed: "/admin/audit-log", denied: null },
  {
    role: "CONTENT",
    allowed: "/admin/erp/artikli",
    denied: "/admin/erp/prodajni-nalozi",
  },
  {
    role: "OPS",
    allowed: "/admin/erp/stanje-po-magacinima",
    denied: "/admin/pocetna",
  },
  {
    role: "ADS",
    allowed: "/admin/oglasi",
    denied: "/admin/erp/stanje-po-magacinima",
  },
] as const;

test.describe("isolated admin role acceptance", () => {
  test.skip(
    process.env.E2E_ADMIN_ROLES !== "1",
    "Set E2E_ADMIN_ROLES=1 to run the isolated SUPER/OPS/CONTENT/ADS matrix.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const password = `QaRoles!${runId}x`;
  const credentials = new Map<AdminRole, { email: string; password: string }>();
  let db: PrismaClient;

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const passwordHash = await bcrypt.hash(password, 10);
    for (const roleCase of cases) {
      const email = `qa.roles.${roleCase.role.toLowerCase()}.${runId}@example.invalid`;
      await db.adminUser.create({
        data: {
          email,
          passwordHash,
          role: roleCase.role,
          enabled: true,
          firstName: "QA",
          lastName: `${roleCase.role} role`,
        },
      });
      credentials.set(roleCase.role, { email, password });
    }
  });

  test.afterAll(async () => {
    if (!db) return;
    const emails = [...credentials.values()].map(({ email }) => email);
    const admins = await db.adminUser.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const adminIds = admins.map(({ id }) => id);
    if (adminIds.length) {
      await db.auditLog.deleteMany({ where: { actorId: { in: adminIds } } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { OR: emails.map((email) => ({ key: { contains: email } })) },
    });
    await db.adminUser.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  for (const roleCase of cases) {
    test(`${roleCase.role} admin access matrix`, async ({ page }) => {
      const credential = credentials.get(roleCase.role);
      if (!credential) throw new Error(`Missing ${roleCase.role} QA fixture.`);
      await login(page, credential, roleCase.allowed);
      await expect(page).toHaveURL(routePattern(roleCase.allowed), {
        timeout: 90_000,
      });

      if (roleCase.denied) {
        await page.goto(roleCase.denied, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/admin\?forbidden=1/, {
          timeout: 90_000,
        });
      }
    });
  }
});

async function login(
  page: Page,
  credential: { email: string; password: string },
  callbackUrl: string,
) {
  await page.goto(
    `/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.getByLabel("E-pošta").fill(credential.email);
  await page.getByLabel("Lozinka").fill(credential.password);
  await page.getByRole("button", { name: "Prijavi se" }).click();
}

function routePattern(route: string) {
  return new RegExp(`${route.replaceAll("/", "\\/")}(?:[?#]|$)`);
}

function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for admin role acceptance.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15_000,
    }),
  });
}
