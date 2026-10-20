import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), complete: vi.fn(), campaigns: vi.fn(), jobs: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { backgroundJob: { findMany: mocks.jobs, updateMany: mocks.update } } }));
vi.mock("@/lib/viber/config", () => ({ isViberReady: () => true }));
vi.mock("@/lib/viber/outbox", () => ({ claimNthMessage: mocks.claim, completeNthMessage: mocks.complete }));
vi.mock("@/lib/viber/campaign", () => ({ runDueCampaigns: mocks.campaigns }));
import { POST } from "@/app/api/viber/worker/route";

const token = "test-worker-token-with-at-least-32-characters";
const request = (body: unknown, bearer = token) => new Request("https://example.com/api/viber/worker", {
  method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("denies missing, placeholder, short, and wrong dedicated tokens including the global cron token", async () => {
  vi.stubEnv("CRON_SECRET", token);
  for (const secret of ["", "GET_FROM_NTH", "short"]) {
    vi.stubEnv("NTH_WORKER_TOKEN", secret);
    expect((await POST(request({ action: "claim" }))).status).toBe(401);
  }
  vi.stubEnv("NTH_WORKER_TOKEN", token);
  expect((await POST(request({ action: "claim" }, "wrong"))).status).toBe(401);
  expect(mocks.claim).not.toHaveBeenCalled();
});
it("allows only bounded worker actions and returns uncached claims", async () => {
  vi.stubEnv("NTH_WORKER_TOKEN", token);
  mocks.claim.mockResolvedValue({ id: "job1", payload: { channels: ["VIBER"] } });
  const response = await POST(request({ action: "claim" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ job: { id: "job1" } });
  expect((await POST(request({ action: "complete", id: "job1", outcome: "retry" }))).status).toBe(400);
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("acknowledges unknown outcomes without requesting a resend", async () => {
  vi.stubEnv("NTH_WORKER_TOKEN", token);
  expect((await POST(request({ action: "complete", id: "job1", outcome: "unknown" }))).status).toBe(200);
  expect(mocks.complete).toHaveBeenCalledWith("job1", "unknown", undefined);
});

it("tracks delivery monotonically and cannot downgrade a read/delivered message to failed", async () => {
  vi.stubEnv("NTH_WORKER_TOKEN", token);
  const id = "a8e4c54d-13ac-42d8-a1d8-1fee84248d7c";
  await POST(request({ action: "delivery", id: "job1", messageId: id, status: "FAILED" }));
  expect(mocks.update.mock.calls[0][0].where).toMatchObject({ kind: "NTH_VIBER_OUTBOUND", lastError: `NTH:${id}`, status: { in: ["VIBER_SENT"] } });
  await POST(request({ action: "delivery", id: "job1", messageId: id, status: "SEEN" }));
  expect(mocks.update.mock.calls[1][0].data.status).toBe("VIBER_SEEN");
  expect((await POST(request({ action: "delivery", id: "job1", messageId: id, status: "arbitrary" }))).status).toBe(400);
});
