// Acceptance: MARKO-95
// Acceptance: MARKO-96
// Acceptance: MARKO-99 (order-item scope; private upload is covered separately)
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import { updateReclamationStatus } from "@/lib/api/reclamation-status";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("kupac i gost prijavljuju reklamaciju", () => {
  test.skip(
    process.env.E2E_RECLAMATION_SUBMISSION !== "1",
    "Set E2E_RECLAMATION_SUBMISSION=1 with an isolated E2E database.",
  );
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const prefix = `QA-REK-SUB-${runId}`;
  const customerEmail = `${prefix.toLowerCase()}@example.invalid`;
  const customerPassword = `QaRek!${runId}x`;
  const guestToken = `${prefix}-guest-token-0123456789`;
  const guestEmail = `${prefix.toLowerCase()}.guest@example.invalid`;
  const recoveryToken = `${prefix}-recovery-token-0123456789`;
  const recoveryEmail = `${prefix.toLowerCase()}.recovery@example.invalid`;
  let db: PrismaClient;
  let userId = "";
  const productIds: string[] = [];
  const orderIds: string[] = [];

  const registeredOrderNumber = `${prefix}-REG`;
  const pendingOrderNumber = `${prefix}-PENDING`;
  const guestOrderNumber = `${prefix}-GUEST`;
  const recoveryOrderNumber = `${prefix}-RECOVERY`;
  const registeredSku = `${prefix}-SKU-REG`;
  const pendingSku = `${prefix}-SKU-PENDING`;
  const guestSku = `${prefix}-SKU-GUEST`;
  const recoverySku = `${prefix}-SKU-RECOVERY`;

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const user = await db.user.create({
      data: {
        email: customerEmail,
        emailVerified: new Date(),
        passwordHash: await bcrypt.hash(customerPassword, 10),
        firstName: "Registrovani",
        lastName: "Kupac",
        name: "Registrovani Kupac",
        phone: `+3816${String(Date.now()).slice(-8)}`,
      },
      select: { id: true },
    });
    userId = user.id;

    for (const [index, sku] of [
      registeredSku,
      pendingSku,
      guestSku,
      recoverySku,
    ].entries()) {
      const product = await db.product.create({
        data: {
          sku,
          slug: `${prefix}-${index}`.toLowerCase(),
          name: `${prefix} artikal ${index + 1}`,
          description: "Privremeni acceptance artikal za reklamaciju.",
          fullPrice: 1_000,
          isActive: false,
        },
        select: { id: true },
      });
      productIds.push(product.id);
    }

    orderIds.push(
      await createOrder({
        number: registeredOrderNumber,
        sku: registeredSku,
        productId: productIds[0]!,
        userId,
        status: "ISPORUCENO",
      }),
      await createOrder({
        number: pendingOrderNumber,
        sku: pendingSku,
        productId: productIds[1]!,
        userId,
        status: "U_ISPORUCI",
      }),
      await createOrder({
        number: guestOrderNumber,
        sku: guestSku,
        productId: productIds[2]!,
        guestEmail,
        accessToken: guestToken,
        status: "ISPORUCENO",
      }),
      await createOrder({
        number: recoveryOrderNumber,
        sku: recoverySku,
        productId: productIds[3]!,
        guestEmail: recoveryEmail,
        accessToken: recoveryToken,
        status: "ISPORUCENO",
      }),
    );
  });

  test.afterAll(async () => {
    if (!db) return;
    const reclamations = await db.reclamation.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const reclamationIds = reclamations.map((row) => row.id);
    await db.emailMessage.deleteMany({
      where: {
        OR: [
          { recipient: { contains: prefix.toLowerCase() } },
          { subject: { contains: prefix } },
        ],
      },
    });
    await db.backgroundJob.deleteMany({
      where: {
        OR: [
          ...reclamationIds.flatMap((id) => [
            { payload: { path: ["reclamationId"], equals: id } },
            { idempotencyKey: { contains: id } },
          ]),
          ...orderIds.map((id) => ({ idempotencyKey: { contains: id } })),
        ],
      },
    });
    await db.reclamation.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { key: { contains: customerEmail } },
          { key: { contains: registeredOrderNumber } },
          { key: { contains: guestOrderNumber } },
        ],
      },
    });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  test("ulogovani kupac vidi samo isporučenu porudžbinu i šalje zahtev", async ({
    page,
  }) => {
    await loginCustomer(page);
    await page.goto("/nalog/reklamacije", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Porudžbina")).toContainText(
      registeredOrderNumber,
    );
    await expect(page.getByLabel("Porudžbina")).not.toContainText(
      pendingOrderNumber,
    );
    await expect(page.getByLabel("Artikal")).toHaveValue(registeredSku);
    await page
      .getByLabel("Komentar / opis problema")
      .fill("Proizvod je oštećen i potrebna je zamena.");
    await page.getByRole("button", { name: "Pošalji reklamaciju" }).click();
    await expect(
      page.getByRole("heading", { name: "Reklamacija je prijavljena" }),
    ).toBeVisible({ timeout: 30_000 });

    const saved = await db.reclamation.findFirstOrThrow({
      where: { order: { number: registeredOrderNumber } },
      include: { events: true },
    });
    expect(saved).toMatchObject({
      userId,
      sku: registeredSku,
      quantity: 1,
      status: "PRIMLJENO",
    });
    expect(saved.events).toEqual([
      expect.objectContaining({ status: "PRIMLJENO", actorId: null }),
    ]);
  });

  test("gost koristi token samo za svoju porudžbinu i šalje zahtev", async ({
    page,
  }) => {
    const invalid = await page.goto(
      `/reklamacije/prijava?order=${encodeURIComponent(guestOrderNumber)}&token=pogresan`,
      { waitUntil: "domcontentloaded" },
    );
    expect(invalid?.status()).toBe(200);
    await expect(page.getByText("Link nije važeći")).toBeVisible();

    await page.goto(
      `/reklamacije/prijava?order=${encodeURIComponent(guestOrderNumber)}&token=${encodeURIComponent(guestToken)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByLabel("Porudžbina")).toContainText(guestOrderNumber);
    await expect(page.getByLabel("Artikal")).toHaveValue(guestSku);

    const foreignItem = await page.request.post("/api/reclamations", {
      headers: { "x-order-access-token": guestToken },
      data: {
        orderNumberOrFiscal: guestOrderNumber,
        sku: registeredSku,
        quantity: 1,
        description: "Pokušaj prijave artikla iz druge porudžbine.",
        photos: [],
      },
    });
    expect(foreignItem.status()).toBe(422);
    await expect(foreignItem.json()).resolves.toMatchObject({
      ok: false,
      reason: "ITEM_NOT_FOUND",
    });

    await page
      .getByLabel("Komentar / opis problema")
      .fill("Gost prijavljuje oštećenje isporučenog artikla.");
    await page.getByRole("button", { name: "Pošalji reklamaciju" }).click();
    await expect(
      page.getByRole("heading", { name: "Reklamacija je prijavljena" }),
    ).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(() =>
        db.reclamation.count({
          where: { order: { number: guestOrderNumber }, userId: null },
        }),
      )
      .toBe(1);

    const saved = await db.reclamation.findFirstOrThrow({
      where: { order: { number: guestOrderNumber } },
      select: { id: true, number: true, notifyVia: true },
    });
    expect(saved.notifyVia).toBe("EMAIL");

    const receiptJob = await db.backgroundJob.findFirstOrThrow({
      where: {
        kind: "RECLAMATION_RECEIPT",
        payload: { path: ["reclamationId"], equals: saved.id },
      },
      select: { id: true },
    });
    await processBackgroundJobsThroughApp(page);
    await expect
      .poll(() =>
        db.backgroundJob.findUnique({
          where: { id: receiptJob.id },
          select: { status: true },
        }),
      )
      .toMatchObject({ status: "COMPLETED" });
    await expect
      .poll(() =>
        db.emailMessage.count({
          where: { kind: "reclamation_receipt", recipient: guestEmail },
        }),
      )
      .toBe(1);

    const event = await updateReclamationStatus({
      reclamationId: saved.id,
      status: "U_OBRADI",
      note: "QA provera obaveštenja gosta.",
    });
    const statusJob = await db.backgroundJob.findUniqueOrThrow({
      where: { idempotencyKey: `reclamation-status-email:${event.id}` },
      select: { id: true },
    });
    await processBackgroundJobsThroughApp(page);
    await expect
      .poll(() =>
        db.backgroundJob.findUnique({
          where: { id: statusJob.id },
          select: { status: true },
        }),
      )
      .toMatchObject({ status: "COMPLETED" });
    await expect
      .poll(() =>
        db.emailMessage.count({
          where: { kind: "reclamation_status", recipient: guestEmail },
        }),
      )
      .toBe(1);
  });

  test("gost može bez otkrivanja podataka da zatraži novi bezbedan link", async ({
    page,
  }) => {
    const before = await db.order.findUniqueOrThrow({
      where: { number: recoveryOrderNumber },
      select: { publicAccessTokenHash: true },
    });

    await page.goto("/reklamacije", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Kupili ste bez naloga?" }),
    ).toBeVisible();
    await page.getByLabel("Broj porudžbine").fill(recoveryOrderNumber);
    await page
      .getByLabel("E-pošta iz porudžbine")
      .fill("pogresna-adresa@example.invalid");
    await page.getByRole("button", { name: "Pošalji bezbedan link" }).click();
    await expect(
      page.getByText("Ako se podaci poklapaju sa isporučenom porudžbinom"),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (
          await db.order.findUniqueOrThrow({
            where: { number: recoveryOrderNumber },
            select: { publicAccessTokenHash: true },
          })
        ).publicAccessTokenHash,
      )
      .toBe(before.publicAccessTokenHash);

    await page.goto("/reklamacije", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Broj porudžbine").fill(recoveryOrderNumber);
    await page.getByLabel("E-pošta iz porudžbine").fill(recoveryEmail);
    await page.getByRole("button", { name: "Pošalji bezbedan link" }).click();
    await expect(
      page.getByText("Ako se podaci poklapaju sa isporučenom porudžbinom"),
    ).toBeVisible();

    await expect
      .poll(async () =>
        (
          await db.order.findUniqueOrThrow({
            where: { number: recoveryOrderNumber },
            select: { publicAccessTokenHash: true },
          })
        ).publicAccessTokenHash,
      )
      .not.toBe(before.publicAccessTokenHash);
    await expect
      .poll(() =>
        db.emailMessage.count({
          where: {
            kind: "guest_reclamation_link",
            recipient: recoveryEmail,
            status: "SENT",
          },
        }),
      )
      .toBe(1);

    await page.goto(
      `/reklamacije/prijava?order=${encodeURIComponent(recoveryOrderNumber)}&token=${encodeURIComponent(recoveryToken)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByText("Link nije važeći")).toBeVisible();
    await expect(page.getByLabel("Broj porudžbine")).toHaveValue(
      recoveryOrderNumber,
    );

    const attempts = [];
    for (let index = 0; index < 6; index += 1) {
      attempts.push(
        await page.request.post("/api/reclamations/guest-link", {
          data: {
            orderNumber: `${prefix}-RATE-LIMIT`,
            email: "rate-limit@example.invalid",
          },
        }),
      );
    }
    expect(attempts.slice(0, 5).every((response) => response.status() === 200)).toBe(
      true,
    );
    expect(attempts[5]?.status()).toBe(429);
  });

  async function createOrder(input: {
    number: string;
    sku: string;
    productId: string;
    status: "ISPORUCENO" | "U_ISPORUCI";
    userId?: string;
    guestEmail?: string;
    accessToken?: string;
  }) {
    const order = await db.order.create({
      data: {
        number: input.number,
        userId: input.userId ?? null,
        guestEmail: input.guestEmail ?? null,
        publicAccessTokenHash: input.accessToken
          ? createHash("sha256")
              .update(input.accessToken, "utf8")
              .digest("base64url")
          : null,
        status: input.status,
        channel: "WEB",
        subtotal: 1_000,
        total: 1_000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Kupac",
        shipPhone: "+381641112223",
        shipStreet: "Test ulica 1",
        shipCity: "Novi Sad",
        shipPostalCode: "21000",
        termsAcceptedAt: new Date(),
        items: {
          create: {
            productId: input.productId,
            sku: input.sku,
            name: `${prefix} test artikal`,
            qty: 1,
            unitPriceFull: 1_000,
            unitPriceSale: 1_000,
          },
        },
      },
      select: { id: true },
    });
    return order.id;
  }

  async function processBackgroundJobsThroughApp(page: Page) {
    const secret =
      process.env.BACKGROUND_JOBS_CRON_SECRET ?? process.env.CRON_SECRET;
    if (!secret) {
      throw new Error(
        "Reclamation acceptance requires BACKGROUND_JOBS_CRON_SECRET or CRON_SECRET.",
      );
    }
    const response = await page.request.post(
      "/api/cron/background-jobs?limit=100",
      { headers: { authorization: `Bearer ${secret}` } },
    );
    expect(response.status()).toBe(200);
  }

  async function loginCustomer(page: Page) {
    await page.goto(
      "/nalog/prijava?callbackUrl=%2Fnalog%2Freklamacije",
      { waitUntil: "domcontentloaded" },
    );
    await page.getByLabel("E-pošta").fill(customerEmail);
    await page.getByLabel("Lozinka").fill(customerPassword);
    await page
      .getByRole("main")
      .getByRole("button", { name: "Prijavi se", exact: true })
      .click();
    await expect(page).toHaveURL(/\/nalog\/reklamacije(?:[?#]|$)/, {
      timeout: 90_000,
    });
  }
});

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is required for reclamation acceptance.");
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
