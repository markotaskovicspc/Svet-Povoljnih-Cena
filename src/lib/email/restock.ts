import "server-only";
import { db } from "@/lib/db";
import { getProductBySku, getProductsBySkus } from "@/lib/api/catalog";
import { getProductAvailability } from "@/lib/product-availability";
import { getEmailConfig } from "./config";
import { isEmailSuppressed } from "./tracking";
import { sendRestockWaitlistAlert } from "./send";

export async function subscribeToRestock(sku: string, email: string, userId?: string) {
  const product = await getProductBySku(sku);
  if (!product?.id) throw new Error("Artikal nije pronađen.");
  if (getProductAvailability(product).canAddToCart) throw new Error("Artikal je već dostupan. Možete ga dodati u korpu.");
  email = email.trim().toLowerCase();
  if (await isEmailSuppressed(email)) throw new Error("Ova adresa trenutno ne može da prima obaveštenja.");
  const productId = product.id;
  const now = new Date();
  // The row lock serializes simultaneous clicks and preserves the enrollment generation.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('restock-enroll'), hashtext(${email + ':' + productId}))::text`;
    const old = await tx.restockSubscription.findUnique({ where: { email_productId: { email, productId: productId } } });
    if (old?.status === "SENDING" || old?.status === "REVIEW") throw new Error("Prijava je već u obradi. Pokušajte kasnije ili kontaktirajte podršku.");
    await tx.restockSubscription.upsert({
      where: { email_productId: { email, productId: productId } },
      create: { email, productId: productId, userId, requestedAt: now },
      update: old?.status === "PENDING" ? { ...(userId ? { userId } : {}), source: "PRODUCT" } : {
        userId, source: "PRODUCT", status: "PENDING", requestedAt: now, checkedAt: now,
        notifiedAt: null, cancelledAt: null, sendStartedAt: null, messageId: null,
      },
    });
    // Interest is a tag, never a grant of general newsletter consent.
    const tag = `interest:${sku}`;
    const contact = await tx.marketingContact.findUnique({ where: { email }, select: { id: true, tags: true } });
    if (contact && !contact.tags.includes(tag)) await tx.marketingContact.update({ where: { id: contact.id }, data: { tags: { push: tag } } });
  });
}

/** Bring the existing registered-customer wishlist alerts into the same send ledger. */
export async function importWishlistRestockAlerts() {
  await db.$executeRaw`
    UPDATE "BackInStockAlert" a SET "notifiedAt" = m."sentAt"
    FROM "EmailMessage" m WHERE a."notifiedAt" IS NULL AND a."channel" = 'EMAIL'
      AND m."idempotencyKey" = 'back_in_stock:' || a."userId" || ':' || a."productId"
      AND m."status" IN ('SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED')
      AND m."sentAt" >= a."createdAt"
  `;
  await db.$executeRaw`
    INSERT INTO "RestockSubscription" ("id", "email", "userId", "productId", "source", "requestedAt", "status")
    SELECT 'wishlist-' || a."id", lower(trim(u."email")), a."userId", a."productId", 'WISHLIST', a."createdAt",
      CASE WHEN EXISTS (SELECT 1 FROM "EmailMessage" m WHERE m."idempotencyKey" = 'back_in_stock:' || a."userId" || ':' || a."productId"
        AND m."status" = 'QUEUED' AND m."createdAt" >= a."createdAt") THEN 'REVIEW' ELSE 'PENDING' END
    FROM "BackInStockAlert" a JOIN "User" u ON u."id" = a."userId"
    WHERE a."notifiedAt" IS NULL AND a."channel" = 'EMAIL' AND u."deletedAt" IS NULL AND trim(u."email") <> ''
    ON CONFLICT ("email", "productId") DO NOTHING
  `;
  await db.$executeRaw`
    UPDATE "RestockSubscription" s SET "status" = 'PENDING', "requestedAt" = a."createdAt", "cancelledAt" = NULL,
      "notifiedAt" = NULL, "sendStartedAt" = NULL, "messageId" = NULL
    FROM "BackInStockAlert" a WHERE s."source" = 'WISHLIST' AND a."userId" = s."userId"
      AND a."productId" = s."productId" AND a."channel" = 'EMAIL' AND a."notifiedAt" IS NULL
      AND a."createdAt" > s."requestedAt" AND s."status" NOT IN ('SENDING', 'REVIEW')
  `;
}

export async function processRestockWaitlist(limit = 100, productId?: string) {
  await importWishlistRestockAlerts();
  const summary = { scanned: 0, sent: 0, skipped: 0, review: 0, remaining: 0, disabled: false };
  if (getEmailConfig().provider === "none") return { ...summary, disabled: true };
  // An expired attempt is uncertain, not an invitation to send another email.
  await db.restockSubscription.updateMany({ where: { status: "SENDING", sendStartedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: "REVIEW" } });
  const groups = await db.restockSubscription.groupBy({ by: ["productId"], where: { status: "PENDING", ...(productId ? { productId } : {}) },
    _min: { checkedAt: true }, orderBy: { _min: { checkedAt: "asc" } }, take: 500 });
  const ids = groups.map(g => g.productId);
  const products = await db.product.findMany({ where: { id: { in: ids } }, select: { sku: true } });
  const available = (await getProductsBySkus(products.map(p => p.sku))).filter(p => p.id && getProductAvailability(p).canAddToCart);
  await db.restockSubscription.updateMany({ where: { status: "PENDING", productId: { in: ids } }, data: { checkedAt: new Date() } });
  const rows = await db.restockSubscription.findMany({
    where: { status: "PENDING", productId: { in: available.flatMap(p => p.id ? [p.id] : []) } },
    take: Math.min(200, Math.max(1, limit)), orderBy: { requestedAt: "asc" },
    include: { product: { select: { sku: true } } },
  });
  const deadline = Date.now() + 50_000;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    summary.scanned++;
    await db.restockSubscription.updateMany({ where: { id: row.id, status: "PENDING" }, data: { checkedAt: new Date() } });
    const product = await getProductBySku(row.product.sku);
    if (!product?.id || !getProductAvailability(product).canAddToCart) continue;
    const user = row.userId ? await db.user.findUnique({ where: { id: row.userId }, select: { email: true, deletedAt: true } }) : null;
    const legacy = row.userId ? await db.backInStockAlert.findFirst({ where: { userId: row.userId, productId: row.productId, channel: "EMAIL", notifiedAt: null }, select: { id: true } }) : null;
    const purchased = await db.orderItem.findFirst({ where: { OR: [{ productId: row.productId }, { sku: row.product.sku }], order: {
      createdAt: { gte: row.requestedAt }, status: { notIn: ["OTKAZANO", "VRACENO"] },
      OR: [{ guestEmail: { equals: row.email, mode: "insensitive" } }, ...(row.userId ? [{ userId: row.userId }] : [])],
    } }, select: { id: true } });
    if ((row.userId && (!user || user.deletedAt || user.email?.toLowerCase() !== row.email)) ||
        (row.source === "WISHLIST" && !legacy) || purchased || await isEmailSuppressed(row.email)) {
      await db.restockSubscription.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "SKIPPED" } });
      summary.skipped++; continue;
    }
    const claimed = await db.restockSubscription.updateMany({ where: { id: row.id, status: "PENDING", requestedAt: row.requestedAt }, data: { status: "SENDING", sendStartedAt: new Date() } });
    if (!claimed.count) continue;
    try {
      // Unsubscribe can cancel a claim before dispatch.
      const current = await db.restockSubscription.findUnique({ where: { id: row.id }, select: { status: true } });
      if (current?.status !== "SENDING") continue;
      const result = await sendRestockWaitlistAlert({ to: row.email, subscriptionId: row.id, requestedAt: row.requestedAt,
        product: { id: product.id, sku: product.sku, slug: product.slug, name: product.name, fullPrice: product.fullPrice, salePrice: product.salePrice } });
      if (!result.ok || result.provider === "none") {
        await db.restockSubscription.updateMany({ where: { id: row.id, status: "SENDING" }, data: { status: "REVIEW" } });
        summary.review++; continue;
      }
      await db.$transaction(async (tx) => {
        await tx.restockSubscription.updateMany({ where: { id: row.id, status: "SENDING" }, data: { status: "SENT", notifiedAt: new Date(), messageId: result.id } });
        if (row.userId) await tx.backInStockAlert.updateMany({ where: { userId: row.userId, productId: row.productId, channel: "EMAIL", createdAt: { lte: row.requestedAt } }, data: { notifiedAt: new Date() } });
      });
      summary.sent++;
    } catch {
      await db.restockSubscription.updateMany({ where: { id: row.id, status: "SENDING" }, data: { status: "REVIEW" } });
      summary.review++;
    }
  }
  summary.remaining = await db.restockSubscription.count({ where: { status: "PENDING", ...(productId ? { productId } : {}) } });
  return summary;
}
