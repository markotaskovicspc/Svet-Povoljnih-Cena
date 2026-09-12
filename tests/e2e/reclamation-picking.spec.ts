import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { requireSafeE2EDatabase } from "../helpers/e2e-database-safety";

const expect = baseExpect.configure({ timeout: 30_000 });

test("saving a removed reclamation never queues it until the operator explicitly adds it", async ({ page }) => {
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
    const warehouse = await db.warehouse.create({ data: { code: tag, name: tag, active: true } });
    warehouseId = warehouse.id;
    const product = await db.product.create({ data: {
      sku: tag, slug: tag.toLowerCase(), name: tag, description: tag, fullPrice: 1000, isActive: false,
      unitPackWidthCm: 30, unitPackDepthCm: 20, unitPackHeightCm: 10, grossWeightKg: 2,
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
      quantity: 1, replacementQty: 1, customerFirst: "QA", customerLast: "Kupac", description: tag,
      notifyVia: "EMAIL", decision: "PRIHVACENA", resolution: "ZAMENA_ARTIKLA", warehouseId, warehouseStatus: "READY",
    } });
    claimId = claim.id;
    const path = `/admin/erp/reklamacije-dnevnik/${claimId}`;
    await page.goto(path);
    await page.getByLabel("E-pošta").fill(email);
    await page.getByLabel("Lozinka").fill(password);
    await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${claimId}$`), { timeout: 30_000 });
    const state = page.getByTestId("reclamation-picking-state");
    const countLines = () => db.pickupBatchLine.count({ where: { reclamationId: claimId } });
    const saveBoth = async (note: string) => {
      await page.getByRole("textbox", { name: "Interna napomena", exact: true }).fill(note);
      await page.getByRole("button", { name: "Sačuvaj odluku", exact: true }).click();
      await expect.poll(async () => (await db.reclamation.findUniqueOrThrow({ where: { id: claimId } })).adminNote).toBe(note);
      await expect(page.getByText("Odluka i način rešavanja su sačuvani. Dodavanje u picking je zaseban korak.")).toBeVisible();
      await page.getByRole("button", { name: "Sačuvaj magacinski zadatak", exact: true }).click();
      await expect(page.getByText("Magacinski zadatak je sačuvan. Dodavanje u picking je zaseban korak.")).toBeVisible();
      await page.reload();
      await expect(state).toContainText("Zamena nije u picking nalogu");
      expect(await countLines()).toBe(0);
    };
    await saveBoth("Pre prvog dodavanja");
    await confirm(page, "Dodaj u picking listu");
    await expect(state).toContainText("Ova zamena je u nalogu");
    const firstLine = await db.pickupBatchLine.findFirstOrThrow({ where: { reclamationId: claimId } });
    batchIds.add(firstLine.batchId);
    // An ordinary delivery in the same batch must survive removal of the replacement.
    const other = await db.pickupBatchLine.create({ data: { batchId: firstLine.batchId, orderId, orderItemId: order.items[0].id, lineGroupKey: `order:${orderId}:X_EXPRESS` } });
    await confirm(page, "Ukloni zamenu iz picking naloga");
    await expect(state).toContainText("Zamena nije u picking nalogu");
    expect(await db.pickupBatchLine.findUnique({ where: { id: other.id } })).not.toBeNull();
    await page.getByRole("combobox", { name: "Način rešavanja", exact: true }).selectOption("ZAMENA_DELA");
    await page.getByRole("spinbutton", { name: /^Celih artikala za slanje/ }).fill("0");
    await page.getByRole("textbox", { name: /^Deo za slanje \/ napomena o rešenju/ }).fill("Naslon");
    await saveBoth("Posle uklanjanja");
    await confirm(page, "Dodaj u picking listu");
    await expect(state).toContainText("Ova zamena je u nalogu");
    const lines = await db.pickupBatchLine.findMany({ where: { reclamationId: claimId } });
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(0);
    batchIds.add(lines[0].batchId);
    expect(await db.shipment.count({ where: { reclamationId: claimId } })).toBe(0);
    const removal = await db.auditLog.findFirstOrThrow({ where: { entityId: claimId, action: "reclamation.pickingRemove" } });
    expect(removal.actorId).toBe(adminId);
    expect(removal.diff).toMatchObject({ removedLineCount: 1, reclamationIds: [claimId] });
    const additions = await db.reclamationStatusEvent.findMany({ where: { reclamationId: claimId, note: { contains: "dodat" } } });
    expect(additions).toHaveLength(2);
    expect(additions.every((event) => event.actorId === adminId)).toBe(true);
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
