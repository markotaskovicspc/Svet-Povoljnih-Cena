import "server-only";
import { z } from "zod";
import { requestNewsletterOptIn } from "@/lib/newsletter/contacts";

/**
 * Newsletter double-opt-in request entry point.
 *
 * Unsubscribe operations intentionally use signed links instead of a public
 * email-only endpoint. Source is a free-form attribution tag.
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
