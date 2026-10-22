import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), find: vi.fn(), update: vi.fn(), send: vi.fn(), fiscal: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { backgroundJob: { updateMany: mocks.claim, findUnique: mocks.find, update: mocks.update } } }));
vi.mock("@/lib/channel-availability.server", () => ({ expirePartnerReservations: vi.fn(), disableInvalidRabaluxWebAvailability: vi.fn() }));
vi.mock("@/lib/email/reclamation-refund-notice", () => ({ sendReclamationRefundOfficeNotice: mocks.send }));
vi.mock("@/lib/admin/reclamation-refund.server", () => ({ issueReceivedReclamationRefund: mocks.fiscal }));
import { processBackgroundJob } from "@/lib/background-jobs";

describe("refund office notification worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claim.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue({ id: "job-1", kind: "RECLAMATION_REFUND_OFFICE_EMAIL", payload: { reclamationId: "claim-1" }, attempts: 1, maxAttempts: 8 });
    mocks.update.mockResolvedValue({});
  });
  it("dispatches the stored claim and completes only after delivery succeeds", async () => {
    expect(await processBackgroundJob("job-1")).toEqual({ claimed: true, ok: true });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith("claim-1");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });
  it("keeps failed sends in RETRY rather than losing the intake notification", async () => {
    mocks.send.mockRejectedValue(new Error("Temporary email failure"));
    expect(await processBackgroundJob("job-1")).toMatchObject({ claimed: true, ok: false, exhausted: false });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RETRY", lastError: expect.stringContaining("Temporary email failure") }) }));
  });
});

it("processes automatic fiscal refund separately from the support notification", async () => {
  mocks.find.mockResolvedValue({ id: "fiscal-job", kind: "RECLAMATION_FISCAL_REFUND", payload: { reclamationId: "claim-1" }, attempts: 1, maxAttempts: 8 });
  expect(await processBackgroundJob("fiscal-job")).toMatchObject({ claimed: true, ok: true });
  expect(mocks.fiscal).toHaveBeenCalledExactlyOnceWith("claim-1");
});
