type BatchResult = { ok: boolean; remaining?: number; nextCursor?: string };
import { newsletterDeliveryPolicy } from "./delivery-policy";

/** Bounded work per invocation; each provider request retains its durable claim. */
export async function runNewsletterBatches<T extends BatchResult>(
  send: () => Promise<T>,
  continueLater: (cursor: string) => Promise<void>,
  clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) },
) {
  const started = clock.now();
  const policy = newsletterDeliveryPolicy();
  let result: T;
  for (let batch = 0; ; batch++) {
    result = await send();
    if (!result.ok || !result.remaining || !result.nextCursor) return result;
    if (batch >= 19 || clock.now() - started + policy.intervalMs > policy.runBudgetMs) break;
    // Never catch up with a burst after slow work; wait the full interval.
    await clock.sleep(policy.intervalMs);
  }
  await continueLater(result.nextCursor!);
  return result;
}
