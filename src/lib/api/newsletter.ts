import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requestNewsletterOptIn,
  withdrawMarketingEmail,
} from "@/lib/newsletter/contacts";

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

export async function subscribeNewsletter(
  input: SubscribeInput,
  evidence?: Record<string, string | null | undefined>,
) {
  return requestNewsletterOptIn({
    email: input.email,
    source: input.source,
    evidence,
  });
}

export async function unsubscribeNewsletter(email: string) {
  const normalized = email.trim().toLowerCase();
  const exists = await db.newsletterSubscriber.findUnique({ where: { email: normalized } });
  if (!exists) throw new Error("not_found");
  await withdrawMarketingEmail(normalized, "newsletter-api");
  return { email: normalized };
}
