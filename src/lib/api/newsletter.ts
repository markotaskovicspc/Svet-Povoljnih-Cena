import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

/**
 * Newsletter subscribe / unsubscribe (Phase 3C — item 7).
 *
 * Idempotent: re-subscribing flips `unsubscribedAt` back to null. Source is a
 * free-form tag (e.g. "footer", "checkout", "popup") used for attribution.
 */

export const subscribeSchema = z.object({
  email: z.email(),
  source: z.string().max(60).optional(),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;

export async function subscribeNewsletter(input: SubscribeInput) {
  const email = input.email.trim().toLowerCase();
  const sub = await db.newsletterSubscriber.upsert({
    where: { email },
    create: { email, source: input.source ?? null, consent: true },
    update: { consent: true, unsubscribedAt: null, source: input.source ?? undefined },
    select: { id: true, email: true, createdAt: true },
  });
  await enqueueBackgroundJob({
    kind: "NEWSLETTER_SYNC",
    payload: { email },
    idempotencyKey: `newsletter-sync:${email}:${Date.now()}`,
  });
  return sub;
}

export async function unsubscribeNewsletter(email: string) {
  const normalized = email.trim().toLowerCase();
  const sub = await db.newsletterSubscriber.update({
    where: { email: normalized },
    data: { unsubscribedAt: new Date(), consent: false },
  });
  await enqueueBackgroundJob({
    kind: "NEWSLETTER_SYNC",
    payload: { email: normalized },
    idempotencyKey: `newsletter-sync:${normalized}:${Date.now()}`,
  });
  return sub;
}
