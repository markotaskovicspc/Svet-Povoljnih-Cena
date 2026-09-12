import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getProductArReport } from "@/lib/admin/product-ar-report.server";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import { AR_EXPERIMENT } from "@/lib/analytics/product-ar-events";
const period = resolveReportPeriod({ range: "custom", from: "2026-08-01", to: "2026-08-02" });
let productId: string, otherId: string;
const at = (day: number) => new Date(Date.UTC(2026, 7, day, 12));
async function ar(who: string, stage: string, variant = "A", surface = "ar_cta") {
  return db.analyticsEvent.create({ data: { type: "PRODUCT_AR", anonymousId: who, productId, consentVersion: "test", occurredAt: at(1), expiresAt: at(90), metadata: { event: stage, surface, experiment: AR_EXPERIMENT, variant, device: "android", source: "facebook", campaign: "desk", content: "video1" } } });
}
async function cart(who: string, day: number, id = productId) { return db.analyticsEvent.create({ data: { type: "ADD_TO_CART", anonymousId: who, productId: id, consentVersion: "test", occurredAt: at(day), expiresAt: at(90) } }); }
async function order(who: string, day: number, id = productId) {
  const order = await db.order.create({ data: { number: `${who}-${day}`, subtotal: 100, total: 100, shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", shipFirstName: "Test", shipLastName: "Test", shipPhone: "000", shipStreet: "Test", shipCity: "Test", shipPostalCode: "00000", termsAcceptedAt: at(day), items: { create: { productId: id, sku: id, name: "Test", qty: 1, unitPriceFull: 100, unitPriceSale: 100 } } } });
  await db.analyticsEvent.create({ data: { type: "CHECKOUT_COMPLETED", anonymousId: who, orderId: order.id, consentVersion: "test", occurredAt: at(day), expiresAt: at(90) } });
}
beforeAll(async () => {
  productId = (await db.product.create({ data: { name: "AR test", sku: "AR-TEST", slug: "ar-test", description: "test", fullPrice: 100 } })).id;
  otherId = (await db.product.create({ data: { name: "Other", sku: "AR-OTHER", slug: "ar-other", description: "test", fullPrice: 100 } })).id;
  await ar("active", "controls_viewed"); await ar("active", "controls_viewed", "A", "photo");
  await ar("active", "model_opened"); await ar("active", "model_used");
  await ar("active", "ar_clicked"); await ar("active", "ar_clicked");
  await ar("active", "ar_attempted"); await ar("active", "ar_attempted");
  await ar("passive", "controls_viewed");
  await ar("before", "controls_viewed", "B"); await ar("before", "model_opened", "B");
  await ar("wrong-product", "controls_viewed", "B");
  await ar("too-late", "controls_viewed", "B");
  await cart("active", 3); await order("active", 3);
  await cart("passive", 4); await order("passive", 4);
  await cart("before", 0); await order("before", 0);
  await cart("wrong-product", 3, otherId); await order("wrong-product", 3, otherId);
  await cart("too-late", 32); await order("too-late", 32);
});
afterAll(async () => { await db.$disconnect(); });
it("counts people once, attempts separately, and conversion of all exposed A/B visitors", async () => {
  const rows = await getProductArReport(period);
  expect(rows.find(r => r.total)).toMatchObject({ visitors: 5, arExposed: 5, photoExposed: 1, opened: 2, used: 1, clicked: 1, attempted: 1, attempts: 2, carts: 2, buyers: 2, engagedBuyers: 1, engagedCarts: 1 });
  expect(rows.find(r => r.variant === "A")).toMatchObject({ arExposed: 2, buyers: 2 });
  expect(rows.find(r => r.variant === "B")).toMatchObject({ arExposed: 3, buyers: 0 });
});
it("filters product, campaign, creative, source, device and variant; empty report remains valid", async () => {
  const filtered = await getProductArReport(period, { product: productId, campaign: "desk", content: "video1", source: "facebook", device: "android", variant: "B" });
  expect(filtered.find(r => r.total)).toMatchObject({ visitors: 3, opened: 1, buyers: 0 });
  expect((await getProductArReport(period, { content: "other-ad" })).find(r => r.total)).toMatchObject({ visitors: 0, attempts: 0 });
});
