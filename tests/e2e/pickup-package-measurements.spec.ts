import { expect as baseExpect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { requireSafeE2EDatabase } from "../helpers/e2e-database-safety";

const expect = baseExpect.configure({ timeout: 30_000 });

test.describe("Individual packaging dimensions in grouped pickup lines", () => {
  test.skip(process.env.E2E_PICKUP_PACKAGE_MEASUREMENTS !== "1",
    "Set E2E_PICKUP_PACKAGE_MEASUREMENTS=1 with an isolated E2E_DATABASE_URL.");
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${process.pid}`;
  const email = `qa.pickup.dimensions.${runId}@example.invalid`;
  const password = `QaDimensions!${runId}`;
  let db: PrismaClient;
  let adminId = "";
  let productId = "";
  let orderId = "";
  let batchId = "";
  let createdWarehouseId = "";

  test.beforeAll(async () => {
    const raw = requireSafeE2EDatabase();
    if (!raw) throw new Error("An isolated E2E_DATABASE_URL is required.");
    const url = new URL(raw);
    const schema = url.searchParams.get("schema")?.trim() || undefined;
    url.searchParams.delete("schema");
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      url.searchParams.set("sslmode", "no-verify");
      url.searchParams.delete("uselibpqcompat");
    }
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }, { schema }) });
    const admin = await db.adminUser.create({ data: {
      email, passwordHash: await bcrypt.hash(password, 12), role: "OPS", enabled: true,
    } });
    adminId = admin.id;
    let warehouse = await db.warehouse.findFirst({ where: { active: true, isDefault: true }, orderBy: { createdAt: "asc" } });
    if (!warehouse) {
      warehouse = await db.warehouse.create({ data: {
        code: `QA-DIM-${runId}`.slice(0, 30), name: "QA package dimensions DC", active: true, isDefault: true,
      } });
      createdWarehouseId = warehouse.id;
    }
    // Mirrors 110088: only individual dimensions exist, with two units per
    // courier package and no packQty to justify using transport weight.
    const product = await db.product.create({ data: {
      sku: `QA-110088-${runId}`, slug: `qa-diamond-seat-${runId}`,
      name: "QA DIAMOND SEAT", description: "Individual packaging regression", fullPrice: 1000,
      courierUnitsPerBox: 2, packQty: null, packGrossWeightKg: 5,
      unitPackWidthCm: 55, unitPackDepthCm: 45, unitPackHeightCm: 21,
      grossWeightKg: 2.6, weightKg: 2,
    } });
    productId = product.id;
    const order = await db.order.create({ data: {
      number: `QA-DIM-${runId}`, status: "KREIRANO", subtotal: 2000, total: 2300, shipping: 300,
      shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA",
      shipFirstName: "QA", shipLastName: "Dimensions", shipPhone: "0601234567",
      shipStreet: "Test 1", shipCity: "Novi Sad", shipPostalCode: "21000", termsAcceptedAt: new Date(),
      items: { create: {
        productId, sku: product.sku, name: product.name, qty: 2,
        warehouseId: warehouse.id, warehouseReservedQty: 2, unitPriceFull: 1000, unitPriceSale: 1000,
      } },
    } });
    orderId = order.id;
    batchId = (await db.pickupBatch.create({ data: {
      number: `PRE-QA-DIM-${runId}`, courier: "COURIER_SMALL", provider: "X_EXPRESS",
    } })).id;
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      if (batchId) await db.pickupBatch.deleteMany({ where: { id: batchId } });
      if (orderId) await db.order.deleteMany({ where: { id: orderId } });
      if (productId) await db.product.deleteMany({ where: { id: productId } });
      if (createdWarehouseId) await db.warehouse.deleteMany({ where: { id: createdWarehouseId } });
      if (adminId) await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.rateLimitBucket.deleteMany({ where: { key: { contains: email } } });
      if (adminId) await db.adminUser.deleteMany({ where: { id: adminId } });
    } finally {
      await db.$disconnect();
    }
  });

  test("loads unit dimensions, prefills legacy blanks, and preserves saved manual measurements", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.addCookies([{ name: "spc_cookie_consent", value: "essential", url: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}` }]);
    const editUrl = `/admin/erp/preuzimanja/${batchId}?mode=edit`;
    await page.goto(editUrl);
    await expect(page).toHaveURL(/\/admin\/prijava/);
    await page.getByLabel("E-pošta").fill(email);
    await page.getByLabel("Lozinka").fill(password);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).not.toHaveURL(/\/admin\/prijava/, { timeout: 60_000 });
    await page.goto(editUrl);
    await page.getByRole("button", { name: "Učitaj porudžbine", exact: true }).click();

    await expect.poll(() => db.pickupBatchLine.count({ where: { batchId, orderId } })).toBe(1);
    const line = await db.pickupBatchLine.findFirstOrThrow({ where: { batchId, orderId } });
    expect(line.packedQuantity).toBe(2);
    expect([Number(line.widthCm), Number(line.depthCm), Number(line.heightCm)]).toEqual([55, 45, 21]);
    expect(line.weightKg).toBeNull();
    const form = page.locator("form").filter({ has: page.locator(`input[name="lineId"][value="${line.id}"]`) }).filter({ has: page.locator('input[name="widthCm"]') });
    await expect(form.locator('input[name="widthCm"]')).toHaveValue("55");
    await expect(form.locator('input[name="depthCm"]')).toHaveValue("45");
    await expect(form.locator('input[name="heightCm"]')).toHaveValue("21");
    await expect(form.locator('input[name="weightKg"]')).toHaveValue("");

    // Existing draft lines must show defaults without silently persisting them
    // or unlocking readiness. A prior manually entered width must win.
    await db.pickupBatchLine.update({ where: { id: line.id }, data: { weightKg: 5, widthCm: 53, depthCm: null, heightCm: null } });
    await page.reload();
    await expect(form.locator('input[name="widthCm"]')).toHaveValue("53");
    await expect(form.locator('input[name="depthCm"]')).toHaveValue("45");
    await expect(form.locator('input[name="heightCm"]')).toHaveValue("21");
    await expect(page.getByRole("button", { name: "Paket je spreman", exact: true })).toBeDisabled();
    expect((await db.pickupBatchLine.findUniqueOrThrow({ where: { id: line.id } })).depthCm).toBeNull();
    await form.locator('input[name="depthCm"]').fill("52");
    await form.locator('input[name="heightCm"]').fill("20");
    await form.getByRole("button", { name: "Sačuvaj", exact: true }).click();
    await expect(page.getByText("Stvarne mere paketa su sačuvane.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Paket je spreman", exact: true })).toBeEnabled();
    await page.reload();
    await expect(form.locator('input[name="widthCm"]')).toHaveValue("53");
    await expect(form.locator('input[name="depthCm"]')).toHaveValue("52");
    await expect(form.locator('input[name="heightCm"]')).toHaveValue("20");
    const saved = await db.pickupBatchLine.findUniqueOrThrow({ where: { id: line.id } });
    expect([Number(saved.weightKg), Number(saved.widthCm), Number(saved.depthCm), Number(saved.heightCm)]).toEqual([5, 53, 52, 20]);
    expect(saved.warehouseReadyAt).toBeNull();

    // Simulated booked state is locked; this test never calls a courier.
    await db.pickupBatch.update({ where: { id: batchId }, data: { status: "BOOKED", labelsCreatedAt: new Date() } });
    await db.product.update({ where: { id: productId }, data: { unitPackWidthCm: 56, unitPackDepthCm: 46, unitPackHeightCm: 22 } });
    await page.reload();
    await expect(page.locator('input[name="widthCm"]')).toHaveCount(0);
    await expect(page.getByText("#1 · 2 kom · 5 kg · 53×52×20 cm", { exact: true }).filter({ visible: true })).toBeVisible();
    const booked = await db.pickupBatchLine.findUniqueOrThrow({ where: { id: line.id } });
    expect([Number(booked.widthCm), Number(booked.depthCm), Number(booked.heightCm)]).toEqual([53, 52, 20]);
    expect(await db.shipment.count({ where: { orderId } })).toBe(0);
    expect(errors).toEqual([]);
  });
});
