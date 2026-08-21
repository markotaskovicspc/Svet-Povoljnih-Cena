import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import {
  hashOrderAccessToken,
  rotateOrderAccessToken,
} from "@/lib/api/order-access";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

export const guestReclamationLinkRequestSchema = z.object({
  orderNumber: z.string().trim().min(3).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type GuestReclamationLinkRequest = z.infer<
  typeof guestReclamationLinkRequestSchema
>;

/**
 * Rotates the guest order token and records the e-mail in the same transaction.
 * A null result deliberately covers every mismatch so callers cannot disclose
 * whether an order number or e-mail address exists.
 */
export async function issueGuestReclamationLink(
  input: GuestReclamationLinkRequest,
): Promise<{ jobId: string } | null> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: {
        number: { equals: input.orderNumber, mode: "insensitive" },
        guestEmail: { equals: input.email, mode: "insensitive" },
        userId: null,
        status: "ISPORUCENO",
      },
      select: { id: true },
    });
    if (!order) return null;

    const accessToken = await rotateOrderAccessToken(order.id, tx);
    const job = await enqueueBackgroundJob(
      {
        kind: "GUEST_RECLAMATION_LINK_EMAIL",
        payload: { orderId: order.id, accessToken },
        idempotencyKey: `guest-reclamation-link:${order.id}:${hashOrderAccessToken(accessToken)}`,
      },
      tx,
    );
    return { jobId: job.id };
  });
}
