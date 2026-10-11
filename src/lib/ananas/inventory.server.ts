import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { ananasInventoryPlan, ananasInventorySku, ANANAS_INVENTORY_START } from "./inventory-plan";

export const ANANAS_INVENTORY_KEY = "ananas-inventory";
const policySchema = z.object({ enabled: z.boolean(), allowNegative: z.boolean(), warehouseId: z.string(),
  historyThrough: z.string().datetime(), leaseToken: z.string().optional(), leaseUntil: z.string().datetime().optional(), documentIdentityVersion: z.literal(2).optional(), historyWindowHours: z.union([z.literal(72), z.literal(24), z.literal(6), z.literal(1)]).optional() });
export type AnanasInventoryPolicy = z.infer<typeof policySchema>;
export async function getAnanasInventoryPolicy(database: Prisma.TransactionClient = db) {
  const setting = await database.adminSetting.findUnique({ where: { key: ANANAS_INVENTORY_KEY } });
  return setting ? policySchema.parse(setting.value) : null;
}
export async function configureAnanasInventory(enabled: boolean, allowNegative: boolean, actorId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
    const warehouses = await tx.warehouse.findMany({ where: { active: true, name: { equals: "Ananas", mode: "insensitive" } } });
    if (warehouses.length !== 1 || warehouses[0].isDefault) throw new Error("Ananas lager traži jedan aktivan, zaseban magacin nazvan Ananas.");
    const previous = await tx.adminSetting.findUnique({ where: { key: ANANAS_INVENTORY_KEY } });
    const old = previous ? policySchema.parse(previous.value) : null;
    if (old && old.warehouseId !== warehouses[0].id) throw new Error("Magacin postojećeg Ananas knjiženja ne može da se zameni.");
    const value: AnanasInventoryPolicy = { ...old, enabled, allowNegative, warehouseId: warehouses[0].id,
      historyThrough: old?.historyThrough ?? ANANAS_INVENTORY_START };
    await tx.adminSetting.upsert({ where: { key: ANANAS_INVENTORY_KEY }, create: { key: ANANAS_INVENTORY_KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
    return value;
  });
}

export async function postAnanasDocumentInventory(documentId: string, actorId?: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
    const setting = await tx.adminSetting.findUnique({ where: { key: ANANAS_INVENTORY_KEY } });
    const policy = setting ? policySchema.parse(setting.value) : null;
    if (!policy?.enabled) return { posted: false, reason: "DISABLED" };
    await tx.$queryRaw`SELECT id FROM "AnanasDocument" WHERE id = ${documentId} FOR UPDATE`;
    const document = await tx.ananasDocument.findUniqueOrThrow({ where: { id: documentId } });
    if (document.issuedAt < new Date(ANANAS_INVENTORY_START)) return { posted: false, reason: "BEFORE_START" };
    const plan = ananasInventoryPlan(document.kind, document.items);
    if (document.inventoryPostedAt) {
      if (document.inventoryFingerprint !== plan.fingerprint) throw new Error("Ananas stavke već knjiženog dokumenta su promenjene. Potrebna je kontrola.");
      return { posted: false, reason: "ALREADY_POSTED" };
    }
    // Archived products still own their historical warehouse ledger. Posting
    // their fiscal documents must not require restoring them to the catalog.
    const products = await tx.product.findMany({ where: { sku: { in: plan.lines.map(line => ananasInventorySku(line.sku)) } }, select: { id: true, sku: true } });
    const bySku = new Map(products.map(product => [product.sku, product]));
    const missing = plan.lines.filter(line => !bySku.has(ananasInventorySku(line.sku)));
    if (missing.length) throw new Error(`Ananas artikli nisu pronađeni: ${missing.map(line => ananasInventorySku(line.sku)).join(", ").slice(0,400)}.`);
    // One document is atomic: neither missing SKUs nor partial retries consume stock.
    for (const line of plan.lines) {
      const product = bySku.get(ananasInventorySku(line.sku))!;
      await adjustInventory(tx, { idempotencyKey: `ananas-fiscal:${document.id}:${line.sku}`, warehouseId: policy.warehouseId,
        productId: product.id, sku: product.sku, qtyDelta: line.qtyDelta,
        kind: document.kind === "SALE" ? "SALE_RESERVATION" : "REFUND_RETURN", actorId,
        note: `Ananas ${document.kind === "SALE" ? "račun" : "refundacija"} ${document.fiscalNumber}; ${document.suborderNumber}`,
        ananasPosting: { allowNegative: policy.allowNegative, issuedAt: document.issuedAt } });
    }
    await tx.ananasDocument.update({ where: { id: document.id }, data: { inventoryPostedAt: new Date(), inventoryFingerprint: plan.fingerprint, inventoryError: null } });
    return { posted: true, lines: plan.lines.length };
  }, { timeout: 60000 });
}

export async function postPendingAnanasInventory(limit = 40, actorId?: string, deadline = Date.now() + 90000, retryErrors = true) {
  const policy = await getAnanasInventoryPolicy();
  if (!policy?.enabled) return { posted: 0, failed: 0 };
  const where = { issuedAt: { gte: new Date(ANANAS_INVENTORY_START) }, inventoryPostedAt: null };
  const size = Math.min(limit, 100);
  const documents = await db.ananasDocument.findMany({ where: { ...where, inventoryError: null },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }], take: size });
  if (retryErrors && documents.length < size) documents.push(...await db.ananasDocument.findMany({ where: { ...where, inventoryError: { not: null } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: size - documents.length }));
  let posted = 0, failed = 0;
  for (const document of documents) {
    if (Date.now() > deadline) break;
    try { if ((await postAnanasDocumentInventory(document.id, actorId)).posted) posted++; }
    catch (error) {
      const message = error instanceof Error && /^(Ananas |Nema dovoljno)/.test(error.message) ? error.message.slice(0, 600) : "Ananas knjiženje nije uspelo. Ponovite obradu.";
      await db.ananasDocument.update({ where: { id: document.id }, data: { inventoryError: message } }); failed++;
    }
  }
  return { posted, failed };
}

export async function getAnanasInventoryStatus() {
  const policy = await getAnanasInventoryPolicy();
  const where = { issuedAt: { gte: new Date(ANANAS_INVENTORY_START) } };
  const [posted, pending, errors, negatives] = await Promise.all([
    db.ananasDocument.count({ where: { ...where, inventoryPostedAt: { not: null } } }),
    db.ananasDocument.count({ where: { ...where, inventoryPostedAt: null } }),
    db.ananasDocument.findMany({ where: { ...where, inventoryPostedAt: null, inventoryError: { not: null } }, select: { id: true, fiscalNumber: true, inventoryError: true }, take: 20 }),
    policy ? db.warehouseStock.count({ where: { warehouseId: policy.warehouseId, qty: { lt: 0 } } }) : 0,
  ]);
  return { policy, posted, pending, errors, negatives };
}
