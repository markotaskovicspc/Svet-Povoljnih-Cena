import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { requireSafeE2EDatabase } from "../helpers/e2e-database-safety";

const expect = baseExpect.configure({ timeout: 30_000 });

test("warehouse readiness and measured parcels wait for explicit picking collection", async ({ page }) => {
  test.skip(process.env.E2E_RECLAMATION_PICKING !== "1", "Requires the isolated reclamation picking runner.");
  test.setTimeout(240_000);
  page.setDefaultTimeout(30_000);
  const raw = requireSafeE2EDatabase();
  if (!raw) throw new Error("An isolated E2E database is required.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema") || undefined;
  url.searchParams.delete("schema");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }, { schema }) });
  const tag = `QA-PICKING-${Date.now()}`;
  const email = `${tag.toLowerCase()}@example.invalid`;
  const password = `${tag}!Secret`;
  let adminId = "", productId = "", orderId = "", warehouseId = "", claimId = "";
  const batchIds = new Set<string>();
  try {
    const admin = await db.adminUser.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: "OPS", enabled: true, firstName: "QA", lastName: "Picking" } });
    adminId = admin.id;
    const warehouse = await db.warehouse.create({ data: { code: tag, name: tag, active: true, isDefault: true } });
    warehouseId = warehouse.id;
    const product = await db.product.create({ data: {
      sku: tag, slug: tag.toLowerCase(), name: tag, description: tag, fullPrice: 1000, isActive: false,
      unitPackWidthCm: 90, unitPackDepthCm: 20, unitPackHeightCm: 10, grossWeightKg: 2,
    } });
    productId = product.id;
    const order = await db.order.create({ data: {
      number: tag, status: "ISPORUCENO", channel: "WEB", subtotal: 1000, total: 1000,
      shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", shipFirstName: "QA", shipLastName: "Kupac",
      shipPhone: "+381641112223", shipStreet: "Test 10", shipCity: "Novi Sad", shipPostalCode: "21000", termsAcceptedAt: new Date(),
      items: { create: { productId, sku: tag, name: tag, qty: 1, unitPriceFull: 1000, unitPriceSale: 1000 } },
    }, include: { items: true } });
    orderId = order.id;
    const claim = await db.reclamation.create({ data: {
      number: `R-${tag}`, orderId, orderItemId: order.items[0].id, productId, sku: tag,
      quantity: 1, replacementQty: 0, customerFirst: "QA", customerLast: "Kupac", description: tag,
      notifyVia: "EMAIL", decision: "PRIHVACENA", resolution: "ZAMENA_DELA", resolutionNote: "Četka", warehouseId, warehouseStatus: "PREPARING",
    } });
    claimId = claim.id;
    const path = `/admin/erp/reklamacije-dnevnik/${claimId}`;
    await page.goto(path);
    await page.getByLabel("E-pošta").fill(email);
    await page.getByLabel("Lozinka").fill(password);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === path, { timeout: 30_000 });
    await expect(page.getByTestId("reclamation-picking-state")).toBeVisible();
    const state = page.getByTestId("reclamation-picking-state");
    const countLines = () => db.pickupBatchLine.count({ where: { reclamationId: claimId } });
    const makeBatch = async (provider: "X_EXPRESS" | "MYGLS", suffix: string) => {
      const batch = await db.pickupBatch.create({ data: { number: `${tag}-${suffix}`, courier: "COURIER_SMALL", provider, status: "DRAFT" } });
      batchIds.add(batch.id);
      return batch.id;
    };
    const xBatch = await makeBatch("X_EXPRESS", "X");
    const glsBatch = await makeBatch("MYGLS", "GLS");
    // Represents an already printed list: this row must survive every step.
    const other = await db.pickupBatchLine.create({ data: { batchId: xBatch, orderId, orderItemId: order.items[0].id, lineGroupKey: `order:${orderId}:X_EXPRESS` } });
    const load = async (batchId: string) => {
      await page.goto(`/admin/erp/preuzimanja/${batchId}`);
      await page.getByRole("button", { name: "Učitaj porudžbine", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: /Nema novih|Učitano/ })).toBeVisible();
    };
    const saveReady = async () => {
      await page.getByRole("combobox", { name: "Status pripreme", exact: true }).selectOption("READY");
      await page.getByRole("button", { name: "Sačuvaj magacinski zadatak", exact: true }).click();
      await expect(page.getByText("Spremnost je sačuvana.", { exact: false })).toBeVisible();
      expect(await countLines()).toBe(0);
    };
    const measure = async (parcel: number, width: string) => {
      await page.getByRole("spinbutton", { name: `Paket ${parcel} · Težina (kg)`, exact: true }).fill("0.2");
      await page.getByRole("spinbutton", { name: `Paket ${parcel} · Širina (cm)`, exact: true }).fill(width);
      await page.getByRole("spinbutton", { name: `Paket ${parcel} · Dužina (cm)`, exact: true }).fill("5");
      await page.getByRole("spinbutton", { name: `Paket ${parcel} · Visina (cm)`, exact: true }).fill("2");
    };
    await expect(page.getByRole("button", { name: "Dodaj u picking listu", exact: true })).toHaveCount(0);
    await load(xBatch);
    expect(await countLines()).toBe(0);
    await page.goto(path);
    await page.getByRole("combobox", { name: "Status pripreme", exact: true }).selectOption("READY");
    await page.getByRole("button", { name: "Sačuvaj magacinski zadatak", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Mere zamene" })).toBeVisible();
    expect((await db.reclamation.findUniqueOrThrow({ where: { id: claimId } })).warehouseStatus).toBe("PREPARING");
    await measure(1, "10");
    await saveReady();
    await page.reload();
    await expect(state).toContainText("Zamena nije u picking nalogu");
    expect(await countLines()).toBe(0);
    expect(await db.pickupBatchLine.count({ where: { batchId: xBatch } })).toBe(1);
    // The catalogue item is 90 cm, but the measured spare part is only 10 cm.
    await load(glsBatch);
    expect(await countLines()).toBe(0);
    await load(xBatch);
    let lines = await db.pickupBatchLine.findMany({ where: { reclamationId: claimId } });
    expect(lines).toHaveLength(1);
    expect(lines[0].batchId).toBe(xBatch);
    expect(lines[0].quantity).toBe(0);
    expect(Number(lines[0].weightKg)).toBe(0.2);
    expect(Number(lines[0].widthCm)).toBe(10);
    expect(lines[0].warehouseReadyById).toBe(adminId);
    expect(lines[0].warehouseReadyAt).not.toBeNull();
    await load(xBatch);
    expect(await countLines()).toBe(1);
    const secondX = await makeBatch("X_EXPRESS", "X2");
    await load(secondX);
    expect((await db.pickupBatchLine.findFirstOrThrow({ where: { reclamationId: claimId } })).batchId).toBe(xBatch);
    await page.goto(path);
    await expect(state).toContainText("Ova zamena je u nalogu");
    await confirm(page, "Ukloni zamenu iz picking naloga");
    await expect(state).toContainText("Zamena nije u picking nalogu");
    expect(await db.pickupBatchLine.findUnique({ where: { id: other.id } })).not.toBeNull();
    // Removal requires a fresh warehouse confirmation before it may be loaded again.
    await load(xBatch);
    expect(await countLines()).toBe(0);
    await page.goto(path);
    await page.getByRole("button", { name: "Dodaj paket", exact: true }).click();
    await measure(1, "10");
    await measure(2, "70");
    await saveReady();
    await load(xBatch);
    expect(await countLines()).toBe(0);
    await load(glsBatch);
    lines = await db.pickupBatchLine.findMany({ where: { reclamationId: claimId }, orderBy: { packageNo: "asc" } });
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.batchId === glsBatch)).toBe(true);
    expect(lines.map((line) => Number(line.widthCm))).toEqual([10, 70]);
    expect(await db.shipment.count({ where: { reclamationId: claimId } })).toBe(0);
    const additions = await db.reclamationStatusEvent.findMany({ where: { reclamationId: claimId, note: { contains: "dodat" } } });
    expect(additions).toHaveLength(2);
    expect(additions.every((event) => event.actorId === adminId)).toBe(true);
    await page.goto(path);
    await page.screenshot({ path: test.info().outputPath("reclamation-picking.png"), fullPage: true });
  } finally {
    await db.pickupBatch.deleteMany({ where: { id: { in: [...batchIds] } } });
    if (claimId) await db.reclamation.deleteMany({ where: { id: claimId } });
    if (orderId) await db.order.deleteMany({ where: { id: orderId } });
    if (productId) await db.product.deleteMany({ where: { id: productId } });
    if (warehouseId) await db.warehouse.deleteMany({ where: { id: warehouseId } });
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.adminUser.deleteMany({ where: { id: adminId } });
    }
    await db.$disconnect();
  }
});

async function confirm(page: Page, name: string) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name, exact: true }).click();
}
