import "server-only";
import type { Prisma } from "@prisma/client";

export function checkoutFollowUpKey(orderId: string) {
  return `checkout-follow-up:${orderId}`;
}

/** Keep this module database-only: checkout must never load worker providers. */
export function queueCheckoutFollowUp(
  tx: Pick<Prisma.TransactionClient, "backgroundJob">,
  orderId: string,
  accessToken: string,
) {
  return tx.backgroundJob.upsert({
    where: { idempotencyKey: checkoutFollowUpKey(orderId) },
    create: {
      kind: "CHECKOUT_POST_COMMIT",
      payload: { orderId, accessToken },
      idempotencyKey: checkoutFollowUpKey(orderId),
      maxAttempts: 8,
    },
    // Replays must not reopen completed work or reset its retry backoff.
    update: {},
    select: { id: true },
  });
}
