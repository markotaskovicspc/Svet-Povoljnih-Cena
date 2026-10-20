import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), find: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { backgroundJob: { updateMany: mocks.claim, findUnique: mocks.find, update: mocks.update } } }));
vi.mock("@/lib/channel-availability.server", () => ({ expirePartnerReservations: vi.fn(), disableInvalidRabaluxWebAvailability: vi.fn() }));
vi.mock("@/lib/email/return-review-notice", () => ({ sendReturnReviewOfficeNotice: mocks.send }));
import { processBackgroundJob } from "@/lib/background-jobs";

describe("return review office worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claim.mockResolvedValue({ count: 1 });
    mocks.find.mockResolvedValue({ id: "job-1", kind: "RETURN_REVIEW_OFFICE_EMAIL", payload: { shipmentId: "s1", parcelNumber: "AAA0850302567" }, attempts: 1, maxAttempts: 8 });
    mocks.update.mockResolvedValue({});
  });
  it("dispatches the stored claim and completes only after delivery succeeds", async () => {
    expect(await processBackgroundJob("job-1")).toEqual({ claimed: true, ok: true });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ shipmentId: "s1", parcelNumber: "AAA0850302567" });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });
  it("keeps failed sends in RETRY rather than losing the intake notification", async () => {
    mocks.send.mockRejectedValue(new Error("Temporary email failure"));
    expect(await processBackgroundJob("job-1")).toMatchObject({ claimed: true, ok: false, exhausted: false });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RETRY", lastError: expect.stringContaining("Temporary email failure") }) }));
  });
});

it("does not resend a completed or concurrently claimed notice", async () => {
  mocks.claim.mockResolvedValue({ count: 0 });
  mocks.send.mockClear();
  expect(await processBackgroundJob("job-1")).toEqual({ claimed: false });
  expect(mocks.send).not.toHaveBeenCalled();
});
