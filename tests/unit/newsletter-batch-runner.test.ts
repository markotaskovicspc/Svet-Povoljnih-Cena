import { afterEach, expect, it, vi } from "vitest";
import { runNewsletterBatches } from "@/lib/newsletter/batch-runner";
import { newsletterDeliveryPolicy } from "@/lib/newsletter/delivery-policy";
function clock() { let time = 0; return { now: () => time, sleep: async (ms: number) => { time += ms; } }; }
afterEach(() => vi.unstubAllEnvs());
it("paces six batches across 50 seconds before one continuation", async () => {
  vi.stubEnv("SES_NEWSLETTER_INTERVAL_SECONDS", "10");
  let sent = 0;
  const send = vi.fn(async () => ({ ok: true, remaining: 70_000 - ++sent * 10, nextCursor: `cursor-${sent}` }));
  const next = vi.fn(); const timer = clock();
  await runNewsletterBatches(send, next, timer);
  expect(send).toHaveBeenCalledTimes(6);
  expect(timer.now()).toBe(50_000);
  expect(next).toHaveBeenCalledExactlyOnceWith("cursor-6");
});
it("stops immediately on completion, review, or SES errors", async () => {
  const next = vi.fn();
  await runNewsletterBatches(async () => ({ ok: true }), next, clock());
  await runNewsletterBatches(async () => ({ ok: false, remaining: 10, nextCursor: "x" }), next, clock());
  await expect(runNewsletterBatches(async () => { throw new Error("throttled"); }, next, clock())).rejects.toThrow("throttled");
  expect(next).not.toHaveBeenCalled();
});
it("yields before waiting would exceed the invocation time budget", async () => {
  let time = 0; const next = vi.fn();
  const send = vi.fn(async () => { time += 45_000; return { ok: true, remaining: 50, nextCursor: "slow" }; });
  const sleep = vi.fn();
  await runNewsletterBatches(send, next, { now: () => time, sleep });
  expect(send).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledExactlyOnceWith("slow");
});
it("caps oversized batches and disallows removing pacing through environment settings", () => {
  vi.stubEnv("SES_NEWSLETTER_BATCH_SIZE", "50");vi.stubEnv("SES_NEWSLETTER_INTERVAL_SECONDS", "0");
  expect(newsletterDeliveryPolicy()).toMatchObject({ batchSize: 10, intervalMs: 10000 });
  vi.stubEnv("SES_NEWSLETTER_INTERVAL_SECONDS", "60");
  expect(newsletterDeliveryPolicy().intervalMs).toBe(60000);
});
