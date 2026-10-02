import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { requireSafeE2EDatabase } from "../helpers/e2e-database-safety";

test("unscanned X Express pickup marked DELETED can be explicitly returned to picking once", async ({ page, context }) => {
  test.skip(process.env.E2E_ORDER_RESHIPMENT !== "1", "Run with the isolated client-feedback acceptance runner.");
  test.setTimeout(240_000);
  const raw = requireSafeE2EDatabase();
  if (!raw) throw new Error("An isolated database is required.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema") ?? "";
  if (!/^client_feedback_e2e_[a-z0-9_]+$/.test(schema)) {
    throw new Error("This acceptance test requires the runner's disposable schema.");
  }
  url.searchParams.delete("schema");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 1 }, { schema }) });
  const run = `unscanned-${Date.now()}`;
  const email = `${run}@example.invalid`;
  const password = `QaPickup!${run}`;
  const reason = "Kurir je preuzeo robu bez skeniranja i sada ne može da je pronađe.";
  try {
    const admin = await db.adminUser.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: "OPS", enabled: true } });
    const warehouse = await db.warehouse.create({ data: { code: run, name: "QA DC", active: true, isDefault: true } });
    const product = await db.product.create({ data: {
      sku: run, slug: run, name: "QA stolica", description: "QA", fullPrice: 1999, salePrice: 1999, stock: 10,
      warehouseStocks: { create: { warehouseId: warehouse.id, qty: 10 } },
    } });
    const order = await db.order.create({ data: {
      number: `QA-${run}`, channel: "WEB", status: "KREIRANO", subtotal: 1999, total: 1998,
      savings: 300, shipping: 299, paymentMethod: "POUZECE_GOTOVINA", shippingMethod: "KURIR",
      shipFirstName: "QA", shipLastName: "Kupac", shipPhone: "0601112223", shipStreet: "Test 1", shipCity: "Beograd", shipPostalCode: "11000", termsAcceptedAt: new Date(),
      items: { create: { productId: product.id, warehouseId: warehouse.id, sku: run, name: product.name, qty: 1, warehouseReservedQty: 1, unitPriceFull: 1999, unitPriceSale: 1999 } },
    }, include: { items: true } });
    const assignment = { assignment: { orderItemIds: [order.items[0].id], codAmount: 1998 } };
    const shipment = await db.shipment.create({ data: {
      orderId: order.id, provider: "X_EXPRESS", service: "COURIER_SMALL", purpose: "ORDER_DELIVERY", status: "FAILED",
      trackingNo: `QA-${run}`, providerShipmentId: `accepted-${run}`, providerStatusCode: "DELETED", rawCreateResponse: assignment,
    } });
    const sourceBatch = await db.pickupBatch.create({ data: {
      number: `PRE-${run}-OLD`, provider: "X_EXPRESS", courier: "COURIER_SMALL", status: "BOOKED", labelsCreatedAt: new Date(),
      // Reproduce the legacy record: no direct shipmentId on the picking line.
      lines: { create: { orderId: order.id, orderItemId: order.items[0].id, lineGroupKey: `order:${order.id}:X_EXPRESS`, purpose: "ORDER_DELIVERY", quantity: 1, packedQuantity: 1, packageNo: 1, weightKg: 5, widthCm: 40, depthCm: 40, heightCm: 40 } },
    } });
    const targetBatch = await db.pickupBatch.create({ data: { number: `PRE-${run}-NEW`, provider: "X_EXPRESS", courier: "COURIER_SMALL", status: "DRAFT" } });

    await page.goto("/admin/prijava?callbackUrl=%2Fadmin");
    await page.getByLabel("E-pošta").fill(email);
    await page.getByLabel("Lozinka").fill(password);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin(?:[?#]|$)/, { timeout: 90_000 });
    await page.goto(`/admin/erp/prodajni-nalozi/${order.id}`);
    const stalePage = await context.newPage();
    await stalePage.goto(`/admin/erp/prodajni-nalozi/${order.id}`);

    for (const current of [page, stalePage]) {
      const form = current.locator("form").filter({ has: current.getByRole("button", { name: "Vrati u picking", exact: true }) });
      const confirmation = form.getByRole("checkbox", { name: /Potvrđujem da je X Express preuzeo robu/ });
      await expect(confirmation).toHaveAttribute("required", "");
      await confirmation.check();
      await form.locator('textarea[name="reason"]').fill(reason);
      await confirm(current, form.getByRole("button", { name: "Vrati u picking", exact: true }));
      // A pending button changes its name to “Čuvanje…”, so disappearance of
      // the original label does not prove the transaction has committed.
      await expect(current.getByRole("link", { name: "očekivanim povratima", exact: true })).toBeVisible({ timeout: 60_000 });
    }

    const retries = await db.orderReshipment.findMany({ where: { orderId: order.id } });
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ batchId: null, sourceShipmentId: shipment.id, reason, actorId: admin.id });
    expect(Number(retries[0].codAmount)).toBe(1998);
    expect(await db.pickupBatch.count()).toBe(2);
    expect(await db.stockMovement.count({ where: { orderId: order.id, kind: "ADJUSTMENT" } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(9);
    expect(await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).toMatchObject({ status: "FAILED", providerStatusCode: "DELETED", trackingNo: shipment.trackingNo, providerShipmentId: shipment.providerShipmentId, rawCreateResponse: assignment, shippedAt: null });
    expect(await db.orderStatusEvent.findFirst({ where: { orderId: order.id, note: { contains: "Operater je potvrdio" } } })).toMatchObject({ actorId: admin.id, status: "U_PRIPREMI" });

    await page.goto(`/admin/erp/preuzimanja/${targetBatch.id}`);
    await page.getByRole("button", { name: "Učitaj porudžbine", exact: true }).click();
    await expect.poll(async () => db.pickupBatchLine.count({ where: { batchId: targetBatch.id, orderId: order.id } }), { timeout: 60_000 }).toBe(1);
    await expect(page.getByRole("button", { name: "Učitaj porudžbine", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Učitaj porudžbine", exact: true }).click();
    await expect.poll(async () => db.auditLog.count({ where: { actorId: admin.id, action: "pickup-batch.orders.load" } }), { timeout: 60_000 }).toBe(2);
    const loaded = await db.pickupBatchLine.findMany({ where: { batchId: targetBatch.id, orderId: order.id } });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ lineGroupKey: `reshipment:${retries[0].id}`, quantity: 1, warehouseReadyAt: null, shipmentId: null });
    expect(await db.pickupBatchLine.count({ where: { batchId: sourceBatch.id, orderId: order.id } })).toBe(1);
    expect((await db.pickupBatch.findUniqueOrThrow({ where: { id: sourceBatch.id } })).status).toBe("BOOKED");
    expect(await db.stockMovement.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(1);
    await stalePage.close();
  } finally {
    await db.$disconnect();
    // The acceptance runner drops the entire temporary schema, including on failure.
  }
});

async function confirm(page: Page, button: Locator) {
  const dialog = page.waitForEvent("dialog");
  const click = button.click();
  await (await dialog).accept();
  await click;
}
