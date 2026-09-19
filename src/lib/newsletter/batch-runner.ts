type BatchResult = { ok: boolean; remaining?: number; nextCursor?: string };

/** Bounded work per invocation; each provider request retains its durable claim. */
export async function runNewsletterBatches<T extends BatchResult>(
  send: () => Promise<T>,
  continueLater: (cursor: string) => Promise<void>,
  clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) },
) {
  const started = clock.now();
  let result: T;
  for (let batch = 0; ; batch++) {
    result = await send();
    if (!result.ok || !result.remaining || !result.nextCursor) return result;
    if (batch >= 19 || clock.now() - started >= 20_000) break;
    // Default 10 recipients per request, with at least a second between requests.
    // Explicit SES throttles stop the run and use the job's exponential backoff.
    await clock.sleep(1000);
  }
  await continueLater(result.nextCursor!);
  return result;
}
