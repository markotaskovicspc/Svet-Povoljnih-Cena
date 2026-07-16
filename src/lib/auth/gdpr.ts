import "server-only";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

/**
 * GDPR / data-portability helpers (per Phase 6 requirements, surfaced from
 * Phase 3B for the account area).
 *
 * - `exportUserData` returns a JSON-serialisable snapshot of every record
 *   tied to the user. Used by the account "Preuzmi moje podatke" button.
 * - `softDeleteAccount` clears PII and marks the account as deleted; long
 *   tail data (orders, reclamations) is retained for legal reasons but
 *   stripped of personal identifiers.
 * - `setMarketingConsent` is the canonical write path for newsletter / SMS
 *   / Viber opt-ins.
 */

export async function exportUserData(userId: string) {
  const [user, addresses, orders, wishlist, reclamations, comments, consent, alerts] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          firstName: true,
          lastName: true,
          isBusiness: true,
          companyName: true,
          pib: true,
          language: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      db.address.findMany({ where: { userId } }),
      db.order.findMany({
        where: { userId },
        include: { items: true },
      }),
      db.wishlistItem.findMany({ where: { userId } }),
      db.reclamation.findMany({ where: { userId } }),
      db.comment.findMany({ where: { userId } }),
      db.marketingConsent.findUnique({ where: { userId } }),
      Promise.all([
        db.backInStockAlert.findMany({ where: { userId } }),
        db.onSaleAlert.findMany({ where: { userId } }),
      ]).then(([backInStock, onSale]) => ({ backInStock, onSale })),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    user,
    addresses,
    orders,
    wishlist,
    reclamations,
    comments,
    consent,
    alerts,
  };
}

export async function softDeleteAccount(userId: string) {
  // Strip PII while keeping financial / legal records for the retention
  // window required by Serbian commerce law.
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: null,
        phone: null,
        name: null,
        firstName: null,
        lastName: null,
        passwordHash: null,
        image: null,
        companyName: null,
        pib: null,
        sessionVersion: { increment: 1 },
      },
    });
    await Promise.all([
      tx.session.deleteMany({ where: { userId } }),
      tx.account.deleteMany({ where: { userId } }),
      tx.address.deleteMany({ where: { userId } }),
      tx.savedCard.deleteMany({ where: { userId } }),
      tx.wishlistItem.deleteMany({ where: { userId } }),
      tx.backInStockAlert.deleteMany({ where: { userId } }),
      tx.onSaleAlert.deleteMany({ where: { userId } }),
      tx.marketingConsent.deleteMany({ where: { userId } }),
      tx.comment.deleteMany({ where: { userId } }),
      tx.reclamation.updateMany({
        where: { userId },
        data: {
          userId: null,
          customerFirst: "Obrisan",
          customerLast: "korisnik",
          customerEmail: null,
          customerPhone: null,
        },
      }),
      user?.email
        ? tx.newsletterSubscriber.deleteMany({ where: { email: user.email } })
        : Promise.resolve(),
    ]);
    if (user?.email) {
      await tx.backgroundJob.upsert({
        where: { idempotencyKey: `account-deletion-unsubscribe:${userId}` },
        create: {
          kind: "RESEND_CONTACT_UNSUBSCRIBE",
          payload: { email: user.email },
          idempotencyKey: `account-deletion-unsubscribe:${userId}`,
        },
        update: {},
      });
    }
  });
}

export async function setMarketingConsent(
  userId: string,
  channels: { email?: boolean; sms?: boolean; viber?: boolean },
) {
  const consent = await db.marketingConsent.upsert({
    where: { userId },
    create: {
      userId,
      email: channels.email ?? false,
      sms: channels.sms ?? false,
      viber: channels.viber ?? false,
    },
    update: {
      ...(channels.email !== undefined ? { email: channels.email } : {}),
      ...(channels.sms !== undefined ? { sms: channels.sms } : {}),
      ...(channels.viber !== undefined ? { viber: channels.viber } : {}),
    },
  });
  if (channels.email !== undefined) {
    await enqueueBackgroundJob({
      kind: "MARKETING_SYNC",
      payload: { userId },
      idempotencyKey: `marketing-sync:${userId}:${consent.updatedAt.toISOString()}`,
    });
  }
  return consent;
}
