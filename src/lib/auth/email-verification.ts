import "server-only";

import { createEmailConfirmationToken } from "@/lib/auth/credentials";
import {
  buildEmailUnsubscribeUrl,
  sendEmailConfirmation,
} from "@/lib/email";

export async function sendEmailConfirmationForUser(
  userId: string,
  options: { includeFirstPurchaseOffer?: boolean } = {},
) {
  const issued = await createEmailConfirmationToken(userId);
  if (!issued) return { ok: true as const, skipped: true as const };
  let marketingUnsubscribeUrl: string | undefined;
  if (options.includeFirstPurchaseOffer) {
    try {
      marketingUnsubscribeUrl = buildEmailUnsubscribeUrl({
        purpose: "marketing",
        userId: issued.userId,
        email: issued.email,
      });
    } catch (err) {
      console.error("[email] marketing unsubscribe URL failed", err);
    }
  }

  const result = await sendEmailConfirmation({
    to: issued.email,
    token: issued.token,
    expiresInHours: issued.expiresInHours,
    includeFirstPurchaseOffer: options.includeFirstPurchaseOffer,
    marketingUnsubscribeUrl,
  });
  return result.ok
    ? { ok: true as const, skipped: false as const }
    : { ok: false as const, error: result.error };
}
