import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), actor: vi.fn(), create: vi.fn(), load: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findFirst: mocks.actor } } }));
vi.mock("@/lib/security/bearer", () => ({ isAuthorizedCronRequest: mocks.auth }));
vi.mock("@/lib/admin/pickup-batch.server", () => ({ createPickupBatch: mocks.create, loadEligibleOrders: mocks.load }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.queue }));
import { GET } from "@/app/api/cron/warehouse-picking/route";
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.auth.mockReturnValue(true); mocks.actor.mockResolvedValue({ id: "ops" }); mocks.create.mockImplementation(async (provider: string) => ({ id: provider })); mocks.load.mockResolvedValue({ added: 1 }); });
it("requires cron authorization before doing any work", async () => {
  mocks.auth.mockReturnValue(false);
  expect((await GET(new Request("https://example.test/cron"))).status).toBe(401);
  expect(mocks.actor).not.toHaveBeenCalled();
});
it("skips the extra UTC invocation", async () => {
  vi.setSystemTime(new Date("2026-10-14T03:00:00Z"));
  expect(await (await GET(new Request("https://example.test/cron"))).json()).toMatchObject({ skipped: true });
  expect(mocks.create).not.toHaveBeenCalled(); vi.useRealTimers();
});
it("collects both providers through existing draft reuse and eligibility helpers", async () => {
  vi.setSystemTime(new Date("2026-10-14T02:00:00Z"));
  const response = await GET(new Request("https://example.test/cron"));
  expect(response.status).toBe(200);
  expect(mocks.create.mock.calls).toEqual([["MYGLS"], ["X_EXPRESS"]]);
  expect(mocks.load.mock.calls).toEqual([["MYGLS", "ops"], ["X_EXPRESS", "ops"]]); vi.useRealTimers();
});
it("continues with the other courier when one preparation fails", async () => {
  vi.setSystemTime(new Date("2026-12-01T03:00:00Z"));
  mocks.create.mockRejectedValueOnce(new Error("temporarily unavailable"));
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(new Request("https://example.test/cron"))).status).toBe(503);
  expect(mocks.load).toHaveBeenCalledWith("X_EXPRESS", "ops"); logger.mockRestore(); vi.useRealTimers();
});

it("queues one morning mail per provider/date after preparation, with stable retry keys", async () => {
  vi.setSystemTime(new Date("2026-10-17T02:00:00Z"));
  await GET(new Request("https://example.test/cron"));
  await GET(new Request("https://example.test/cron"));
  expect(mocks.queue.mock.calls[0][0]).toEqual(mocks.queue.mock.calls[2][0]);
  expect(mocks.queue.mock.calls[1][0]).toEqual(mocks.queue.mock.calls[3][0]);
  expect(mocks.queue.mock.calls[0][0]).toEqual({ kind: "WAREHOUSE_MORNING_EMAIL", payload: { batchId: "MYGLS", provider: "MYGLS", date: "2026-10-17" }, idempotencyKey: "warehouse-morning:2026-10-17:MYGLS" });
  expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(mocks.queue.mock.invocationCallOrder[0]);
  vi.useRealTimers();
});
it("reports mail queue failure so preparation cannot appear fully successful", async () => {
  vi.setSystemTime(new Date("2026-12-01T03:00:00Z"));
  mocks.queue.mockRejectedValueOnce(new Error("queue unavailable"));
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(new Request("https://example.test/cron"))).status).toBe(503);
  expect(mocks.queue).toHaveBeenCalledTimes(2);
  logger.mockRestore(); vi.useRealTimers();
});
