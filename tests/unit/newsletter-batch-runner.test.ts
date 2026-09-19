import { expect, it, vi } from "vitest";
import { runNewsletterBatches } from "@/lib/newsletter/batch-runner";
function clock() { let time = 0; return { now: () => time, sleep: async (ms: number) => { time += ms; } }; }
it("bounds a large campaign to 20 paced batches and queues exactly one continuation", async () => {
  let sent = 0;
  const send = vi.fn(async () => ({ ok: true, remaining: 70_000 - ++sent * 10, nextCursor: `cursor-${sent}` }));
  const next = vi.fn(); const timer = clock();
  await runNewsletterBatches(send, next, timer);
  expect(send).toHaveBeenCalledTimes(20);
  expect(timer.now()).toBe(19_000);
  expect(next).toHaveBeenCalledExactlyOnceWith("cursor-20");
});
it("stops immediately on completion, review, or SES errors", async () => {
  const next = vi.fn();
  await runNewsletterBatches(async () => ({ ok: true }), next, clock());
  await runNewsletterBatches(async () => ({ ok: false, remaining: 10, nextCursor: "x" }), next, clock());
  await expect(runNewsletterBatches(async () => { throw new Error("throttled"); }, next, clock())).rejects.toThrow("throttled");
  expect(next).not.toHaveBeenCalled();
});
it("yields after a slow batch exceeds the time budget", async () => {
  let time = 0; const next = vi.fn();
  const send = vi.fn(async () => { time += 21_000; return { ok: true, remaining: 50, nextCursor: "slow" }; });
  await runNewsletterBatches(send, next, { now: () => time, sleep: async () => {} });
  expect(send).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledExactlyOnceWith("slow");
});
