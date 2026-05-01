import "server-only";
import { db } from "@/lib/db";

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
  const [user, addresses, orders, wishlist, reclamations, consent, alerts] =
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
    consent,
    alerts,
  };
}

export async function softDeleteAccount(userId: string) {
  // Strip PII while keeping financial / legal records for the retention
  // window required by Serbian commerce law.
  await db.$transaction([
    db.user.update({
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
      },
    }),
    db.session.deleteMany({ where: { userId } }),
    db.account.deleteMany({ where: { userId } }),
    db.address.deleteMany({ where: { userId } }),
    db.savedCard.deleteMany({ where: { userId } }),
    db.wishlistItem.deleteMany({ where: { userId } }),
    db.backInStockAlert.deleteMany({ where: { userId } }),
    db.onSaleAlert.deleteMany({ where: { userId } }),
    db.marketingConsent.deleteMany({ where: { userId } }),
  ]);
}

export async function setMarketingConsent(
  userId: string,
  channels: { email?: boolean; sms?: boolean; viber?: boolean },
) {
  return db.marketingConsent.upsert({
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
}
