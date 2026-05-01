import "server-only";
import { db } from "@/lib/db";

/**
 * Saved card management for `/nalog/kartice` (Phase 3C — item 4).
 *
 * Cards themselves live tokenized on WSPay (Phase 4B). We store only the brand
 * + last4 + token, never the PAN. Adding a new card happens via the WSPay
 * tokenization redirect; this module exposes only list / setDefault / delete.
 */

export async function listSavedCards(userId: string) {
  return db.savedCard.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      holderName: true,
      isDefault: true,
      createdAt: true,
    },
  });
}

export async function setDefaultCard(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const card = await tx.savedCard.findFirst({ where: { id, userId } });
    if (!card) throw new Error("CARD_NOT_FOUND");
    await tx.savedCard.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.savedCard.update({ where: { id }, data: { isDefault: true } });
  });
}

export async function deleteSavedCard(userId: string, id: string) {
  const res = await db.savedCard.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
