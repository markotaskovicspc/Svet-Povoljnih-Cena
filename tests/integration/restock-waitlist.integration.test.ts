import { expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { ProductDTO } from "@/lib/api/catalog";
const sender = vi.hoisted(() => vi.fn(async () => ({ ok: true, id: "mock-message", provider: "resend" })));
vi.mock("@/lib/email/send", () => ({ sendRestockWaitlistAlert: sender }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ provider: "resend" }) }));
vi.mock("@/lib/api/catalog", () => { const read = async (sku: string) => {
  const p = await db.product.findUnique({ where: { sku } });
  return p && { id: p.id, sku, slug: p.slug, name: p.name, fullPrice: Number(p.fullPrice), stock: p.stock,
    incomingStock: 0, dimensionsCm: { w: 10, d: 10, h: 10 }, media: { images: [{ url: "/test.jpg" }] }, deliveryDays: { min: 1, max: 2 } } as ProductDTO;
}; return { getProductBySku: read, getProductsBySkus: async (skus: string[]) => (await Promise.all(skus.map(read))).filter(Boolean) }; });
import { subscribeToRestock, processRestockWaitlist } from "@/lib/email/restock";

it("keeps consent scoped, serializes enrollment and manual/automatic sends, handles re-enrollment, suppression and uncertain sends", async () => {
  const prefix = `QA-RESTOCK-${Date.now()}`;
  const email = `${prefix.toLowerCase()}@example.test`;
  const p = await db.product.create({ data: { sku: prefix, slug: prefix.toLowerCase(), name: prefix, description: "QA", fullPrice: 100, stock: 0 } });
  const user = await db.user.create({ data: { email } });
  const contact = await db.marketingContact.create({ data: { email, status: "PENDING", source: "QA" } });
  try {
    await Promise.all([subscribeToRestock(prefix, ` ${email.toUpperCase()} `), subscribeToRestock(prefix, email, user.id)]);
    let row = await db.restockSubscription.findUniqueOrThrow({ where: { email_productId: { email, productId: p.id } } });
    expect(await db.restockSubscription.count({ where: { productId: p.id } })).toBe(1);
    expect(row.userId).toBe(user.id);
    const consent = await db.marketingContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(consent.status).toBe("PENDING"); expect(consent.tags).toEqual([`interest:${prefix}`]);
    const firstGeneration = row.requestedAt;
    expect((await processRestockWaitlist(25, p.id)).sent).toBe(0);
    await db.backInStockAlert.create({ data: { userId: user.id, productId: p.id, createdAt: firstGeneration } });
    await db.product.update({ where: { id: p.id }, data: { stock: 2 } });
    await expect(subscribeToRestock(prefix, email)).rejects.toThrow(/već dostupan/);
    await Promise.all([processRestockWaitlist(25, p.id), processRestockWaitlist(25, p.id)]);
    expect(sender).toHaveBeenCalledTimes(1);
    row = await db.restockSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.status).toBe("SENT"); expect(row.notifiedAt).not.toBeNull();
    expect((await db.backInStockAlert.findFirstOrThrow({ where: { productId: p.id } })).notifiedAt).not.toBeNull();
    await db.product.update({ where: { id: p.id }, data: { stock: 0 } });
    await subscribeToRestock(prefix, email, user.id);
    row = await db.restockSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.requestedAt.getTime()).toBeGreaterThan(firstGeneration.getTime());
    await db.restockSubscription.update({ where: { id: row.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await db.product.update({ where: { id: p.id }, data: { stock: 2 } });
    expect((await processRestockWaitlist(25, p.id)).sent).toBe(0);
    await db.restockSubscription.update({ where: { id: row.id }, data: { status: "PENDING" } });
    await db.emailSuppression.create({ data: { email, reason: "complaint", provider: "QA" } });
    expect((await processRestockWaitlist(25, p.id)).skipped).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    await db.emailSuppression.delete({ where: { email } });
    await db.restockSubscription.update({ where: { id: row.id }, data: { status: "PENDING" } });
    sender.mockRejectedValueOnce(new Error("provider timeout"));
    expect((await processRestockWaitlist(25, p.id)).review).toBe(1);
    expect((await processRestockWaitlist(25, p.id)).sent).toBe(0);
    expect(sender).toHaveBeenCalledTimes(2);
  } finally {
    await db.emailSuppression.deleteMany({ where: { email } });
    await db.backInStockAlert.deleteMany({ where: { productId: p.id } });
    await db.restockSubscription.deleteMany({ where: { productId: p.id } });
    await db.marketingContact.delete({ where: { id: contact.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.product.delete({ where: { id: p.id } });
  }
});
