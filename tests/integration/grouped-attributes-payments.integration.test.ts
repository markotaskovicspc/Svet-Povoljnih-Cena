import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(),
}));
import { db } from "@/lib/db";
import { listProducts, listProductFacets } from "@/lib/api/catalog";
import { saveProductAttributeSelection } from "@/lib/admin/grouped-attributes.server";
import { copyArticleRelations, articleCopySelect } from "@/lib/admin/article-copy.server";
import { capturePaymentSnapshot, recordPurchasePayment, summarizePurchasePayments, voidPurchasePayment } from "@/lib/admin/purchase-payments.server";
import { saveInboundInvoice } from "@/lib/admin/inbound-invoice.server";
import { Prisma } from "@prisma/client";
import { listSearchProducts, listSearchProductFacets } from "@/lib/api/search-listing";
import { searchProductSkus } from "@/lib/api/search";

const prefix = "ATTR-PAY-" + randomUUID();
let categoryId: string, rootId: string, groupId: string, priceListId: string;
let sectionId: string, featureId: string, leftId: string, rightId: string, yesId: string;
let poId: string, supplierId: string, warehouseId: string, receiptId: string;
const productIds: string[] = [];
const categoryPath = "/" + prefix.toLowerCase() + "/artikli";

beforeAll(async () => {
  process.env.ENFORCE_WEB_AUTO_AVAILABILITY = "false";
  const root = await db.category.create({ data: { name: prefix, slug: prefix.toLowerCase(), path: "/" + prefix.toLowerCase() } });
  rootId = root.id;
  categoryId = (await db.category.create({ data: { name: "Artikli", slug: prefix.toLowerCase() + "-artikli", path: categoryPath, parentId: root.id, level: 1 } })).id;
  groupId = (await db.group.create({ data: { name: prefix, slug: prefix.toLowerCase() } })).id;
  priceListId = (await db.priceList.create({ data: { code: prefix, name: prefix, kind: "RETAIL", active: true, currency: "RSD" } })).id;
  const section = await db.attributeSection.create({ data: { name: prefix + " Ugao",
    options: { create: [{ value: "Da" }, { value: "Ne", order: 1 }] } }, include: { options: { orderBy: { order: "asc" } } } });
  sectionId = section.id; leftId = section.options[0].id; rightId = section.options[1].id;
  const feature = await db.attributeSection.create({ data: { name: prefix + " Kutija", order: 1, options: { create: { value: "Da" } } }, include: { options: true } });
  featureId = feature.id; yesId = feature.options[0].id;
  for (let i = 0; i < 41; i++) {
    const row = await db.product.create({ data: {
      sku: prefix + "-" + i, slug: prefix.toLowerCase() + "-" + i, name: prefix + " " + i,
      description: "QA", fullPrice: 1000, groupId, attribute1: "STARI ATRIBUT",
      stock: 5, availableWebManual: true, articleStatus: "SP",
      categories: { create: { categoryId } },
      priceListEntries: { create: { priceListId, price: 1000, validFrom: new Date("2026-01-01") } },
      attributeAssignments: { create: [
        { optionId: i === 40 ? rightId : leftId }, ...(i % 2 === 0 ? [{ optionId: yesId }] : []),
      ] },
    } });
    productIds.push(row.id);
  }
  supplierId = (await db.supplier.create({ data: { code: prefix, name: prefix, currency: "EUR", enabled: true } })).id;
  warehouseId = (await db.warehouse.create({ data: { code: prefix, name: prefix, active: true } })).id;
  poId = (await db.purchaseOrder.create({ data: { number: prefix, supplierId, currency: "EUR",
    lockedAt: new Date(), status: "CONFIRMED" } })).id;
  receiptId = (await db.inboundInvoice.create({ data: { number: prefix, purchaseOrderId: poId } })).id;
});

afterAll(async () => {
  await db.inboundInvoice.deleteMany({ where: { id: receiptId } });
  await db.purchaseOrderPayment.deleteMany({ where: { purchaseOrderId: poId } });
  await db.purchaseOrder.deleteMany({ where: { id: poId } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.attributeOption.deleteMany({ where: { sectionId: { in: [sectionId, featureId] } } });
  await db.attributeSection.deleteMany({ where: { id: { in: [sectionId, featureId] } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.category.deleteMany({ where: { id: rootId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.priceList.deleteMany({ where: { id: priceListId } });
  await db.supplier.deleteMany({ where: { id: supplierId } });
  await db.warehouse.deleteMany({ where: { id: warehouseId } });
  await db.$disconnect();
});

describe("attributes over the complete catalog scope", () => {
  it("includes values beyond the first product page and filters by stable IDs", async () => {
    const first = await listProducts({ categoryPath, limit: 1 });
    expect(first.total).toBe(41);
    const facets = await listProductFacets({ categoryPath });
    expect(facets.facets.attributeSections?.find((s) => s.id === sectionId)?.values)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: rightId, count: 1 })]));
    const filtered = await listProducts({ categoryPath, groupedAttributes: { [sectionId]: [rightId] } });
    expect(filtered.items.map((item) => item.id)).toEqual([productIds[40]]);
    expect(filtered.items[0].groupedAttributes).toEqual(expect.arrayContaining([expect.objectContaining({ optionId: rightId })]));
    expect(filtered.items[0].attributes).toContain("STARI ATRIBUT");
  });
  it("combines OR inside one section with AND across sections", async () => {
    const result = await listProducts({ categoryPath, groupedAttributes: { [sectionId]: [leftId, rightId], [featureId]: [yesId] } });
    expect(result.total).toBe(21);
  });
  it("omits deactivated sections and rejects new inactive assignments without erasing saved ones", async () => {
    await db.attributeSection.update({ where: { id: featureId }, data: { active: false } });
    expect((await listProductFacets({ categoryPath })).facets.attributeSections?.some((s) => s.id === featureId)).toBe(false);
    await expect(db.$transaction((tx) => saveProductAttributeSelection(tx, productIds[1], [leftId, yesId]))).rejects.toThrow("više nije dostupan");
    await db.$transaction((tx) => saveProductAttributeSelection(tx, productIds[0], [leftId, yesId]));
    await db.attributeSection.update({ where: { id: featureId }, data: { active: true } });
  });
  it("copies grouped attributes with the existing article-copy operation", async () => {
    const source = await db.product.findUniqueOrThrow({ where: { id: productIds[0] }, select: articleCopySelect });
    const copy = await db.product.create({ data: { sku: prefix + "-copy", slug: prefix.toLowerCase() + "-copy", name: "Copy", description: "", fullPrice: 1000 } });
    productIds.push(copy.id);
    await db.$transaction((tx) => copyArticleRelations(tx, copy.id, source));
    expect(await db.productAttributeAssignment.count({ where: { productId: copy.id } })).toBe(2);
  });
  it("uses the complete search scope for facets, filters and cursor pagination", async () => {
    const first = await listSearchProducts(prefix, { limit: 1 });
    expect(first.total).toBe(41);
    expect(first.nextCursor).toBeTruthy();
    const second = await listSearchProducts(prefix, { limit: 1, cursor: first.nextCursor! });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const facets = await listSearchProductFacets(prefix);
    expect(facets.facets.attributeSections?.find((s) => s.id === sectionId)?.values)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: rightId, count: 1 })]));
    const filtered = await listSearchProducts(prefix, { groupedAttributes: { [sectionId]: [rightId] } });
    expect(filtered.items.map((item) => item.id)).toEqual([productIds[40]]);
    expect((await listSearchProducts("nohit" + randomUUID().replaceAll("-", ""))).total).toBe(0);
  });
  it("does not truncate search facets at the old 1000-candidate boundary", async () => {
    const query = "scope" + randomUUID().replaceAll("-", "");
    const rows = Array.from({ length: 1005 }, (_, i) => ({
      id: randomUUID(), sku: query + "-" + i, slug: query + "-" + i,
      name: query + " " + i, description: "QA", fullPrice: 1000,
      stock: 5, groupId, availableWebManual: true, isActive: true, articleStatus: "SP" as const,
    }));
    await db.product.createMany({ data: rows });
    productIds.push(...rows.map((row) => row.id));
    await db.productCategory.createMany({ data: rows.map((row) => ({ productId: row.id, categoryId })) });
    await db.priceListEntry.createMany({ data: rows.map((row) => ({
      productId: row.id, priceListId, price: 1000, validFrom: new Date("2026-01-01"),
    })) });
    await db.productAttributeAssignment.create({ data: { productId: rows.at(-1)!.id, optionId: rightId } });
    expect(await searchProductSkus(query)).toHaveLength(1005);
    const facets = await listSearchProductFacets(query);
    expect(facets.facets.attributeSections?.find((s) => s.id === sectionId)?.values)
      .toContainEqual(expect.objectContaining({ id: rightId, count: 1 }));
    const filtered = await listSearchProducts(query, { groupedAttributes: { [sectionId]: [rightId] } });
    expect(filtered.items.map((row) => row.id)).toEqual([rows.at(-1)!.id]);
  });
});

describe("executed payments and receipt snapshots", () => {
  it("records on locked orders, prevents duplicate submissions, sums actual RSD and rejects stale transfers", async () => {
    const first = { id: randomUUID(), purchaseOrderId: poId, paidAt: "2026-10-22", amount: "300", amountRsd: "35100", notes: "Avans" };
    await Promise.all([recordPurchasePayment(first, "qa"), recordPurchasePayment(first, "qa")]);
    expect(await db.purchaseOrderPayment.count({ where: { purchaseOrderId: poId } })).toBe(1);
    const before = summarizePurchasePayments(await db.purchaseOrderPayment.findMany({ where: { purchaseOrderId: poId } }));
    const second = await recordPurchasePayment({ ...first, id: randomUUID(), paidAt: "2026-10-24", amount: "700", amountRsd: "82600", notes: "" }, "qa");
    await expect(capturePaymentSnapshot(poId, before.version)).rejects.toThrow("Uplate su promenjene");
    const summary = summarizePurchasePayments(await db.purchaseOrderPayment.findMany({ where: { purchaseOrderId: poId } }));
    expect(summary).toMatchObject({ count: 2, totalAmount: "1000.00", totalRsd: "117700.00" });
    await saveInboundInvoice({ id: receiptId, number: prefix, receiptDate: new Date(), purchaseOrderId: poId,
      warehouseId, currency: "RSD", exchangeRate: 1, invoiceValue: 117700, invoiceValueRsd: 117700,
      customsValueRsd: 100, transportValueRsd: 200, otherRelatedCostsRsd: 300, notes: null,
      paymentVersion: summary.version });
    const saved = await db.inboundInvoice.findUniqueOrThrow({ where: { id: receiptId } });
    expect(Number(saved.invoiceValueRsd)).toBe(117700);
    expect(Number(saved.netValue)).toBe(118300);
    expect(saved.paymentSnapshot).toMatchObject({ totalRsd: "117700.00", payments: expect.any(Array) });
    await db.inboundInvoice.update({ where: { id: receiptId }, data: { lockedAt: new Date(), status: "POSTED" } });
    await voidPurchasePayment(poId, second.id);
    await recordPurchasePayment({ ...first, id: randomUUID(), amount: "1", amountRsd: "118" }, "qa");
    const after = await db.inboundInvoice.findUniqueOrThrow({ where: { id: receiptId } });
    expect(after.paymentSnapshot).toEqual(saved.paymentSnapshot);
    expect(after.invoiceValueRsd).toEqual(saved.invoiceValueRsd);
    expect(after.netValue).toEqual(saved.netValue);
    expect((await db.product.findUniqueOrThrow({ where: { id: productIds[0] } })).cogs).toBeNull();
  });
  it("prevents changing the currency of an order with active payments", async () => {
    await expect(db.purchaseOrder.update({ where: { id: poId }, data: { currency: "USD" } })).rejects.toThrow();
  });
  it("applies the currency guard to the trigger table's schema", async () => {
    const schema = "qa_attribute_guard_" + randomUUID().replaceAll("-", "");
    await db.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    try {
      await db.$executeRawUnsafe('CREATE TABLE "' + schema + '"."PurchaseOrder" (id TEXT PRIMARY KEY, currency TEXT)');
      await db.$executeRawUnsafe('CREATE TABLE "' + schema + '"."PurchaseOrderPayment" ("purchaseOrderId" TEXT, "voidedAt" TIMESTAMP)');
      await db.$executeRawUnsafe('CREATE TRIGGER guard BEFORE UPDATE OF currency ON "' + schema + '"."PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_purchase_order_currency_change()');
      await db.$executeRawUnsafe('INSERT INTO "' + schema + '"."PurchaseOrder" VALUES (\'po\', \'EUR\')');
      await db.$executeRawUnsafe('INSERT INTO "' + schema + '"."PurchaseOrderPayment" VALUES (\'po\', NULL)');
      await expect(db.$executeRawUnsafe('UPDATE "' + schema + '"."PurchaseOrder" SET currency = \'USD\' WHERE id = \'po\'')).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
    }
  });
  it("requires RSD ledger amounts to agree even for writes bypassing the form", async () => {
    const order = await db.purchaseOrder.create({ data: { number: prefix + "-rsd", currency: "RSD" } });
    try {
      const row = await recordPurchasePayment({ id: randomUUID(), purchaseOrderId: order.id,
        paidAt: "2026-10-23", amount: "123.45", amountRsd: "999" }, "qa");
      expect(row.amountRsd.toFixed(2)).toBe("123.45");
      await expect(db.purchaseOrderPayment.create({ data: { purchaseOrderId: order.id, actorId: "qa",
        paidAt: new Date(), currency: "RSD", amount: new Prisma.Decimal(1), amountRsd: new Prisma.Decimal(2) } })).rejects.toThrow();
    } finally {
      await db.purchaseOrderPayment.deleteMany({ where: { purchaseOrderId: order.id } });
      await db.purchaseOrder.delete({ where: { id: order.id } });
    }
  });
});
