import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), bucket: vi.fn() }));
vi.mock("@/lib/db", () => ({ databaseIdentifier: (name: string) => Prisma.raw(`"${name}"`), db: { $queryRaw: mocks.query, $executeRaw: mocks.execute, rateLimitBucket: { findUnique: mocks.bucket } } }));
import { withNewsletterDeliveryPacing } from "@/lib/newsletter/delivery-pacing";
import { BackgroundJobDeferredError } from "@/lib/background-job-deferral";
const resetAt = new Date("2026-09-19T14:00:00Z");
beforeEach(() => { vi.clearAllMocks();mocks.query.mockResolvedValue([{count: 7, leaseUntil: "2026-09-19 14:00:00"}]);mocks.execute.mockResolvedValue(1); });
it("does not call SES when another worker holds the shared lease", async () => {
  mocks.query.mockResolvedValue([]);mocks.bucket.mockResolvedValue({resetAt});
  const send = vi.fn();
  await expect(withNewsletterDeliveryPacing("eu-central-1",send)).rejects.toMatchObject({availableAt:resetAt});
  expect(send).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
});
it("persists a cooldown after success and ties release to the exact lease", async () => {
  const send = vi.fn(async()=>({ok:true}));
  await expect(withNewsletterDeliveryPacing("eu-central-1",send)).resolves.toEqual({ok:true});
  expect(send).toHaveBeenCalledOnce();expect(mocks.execute).toHaveBeenCalledOnce();
  expect(mocks.execute.mock.calls[0][0].values).toEqual([10000,"newsletter:ses:pacing:eu-central-1",7,"2026-09-19 14:00:00"]);
});
it("also paces failures without swallowing the provider error", async () => {
  await expect(withNewsletterDeliveryPacing("eu-central-1",async()=>{throw new Error("ses:AccessDenied");})).rejects.toThrow("ses:AccessDenied");
  expect(mocks.execute).toHaveBeenCalledOnce();
});
it("deferred waits do not turn a campaign into FAILED", async () => {
  const { failNewsletterCampaign }=await import("@/lib/newsletter/campaigns");
  await expect(failNewsletterCampaign("campaign",new BackgroundJobDeferredError(resetAt))).resolves.toBeUndefined();
});
