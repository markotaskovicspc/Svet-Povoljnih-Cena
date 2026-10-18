import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sessions: vi.fn(), order: vi.fn(), existing: vi.fn(), claim: vi.fn(), update: vi.fn(),
  suppressed: vi.fn(), dispatch: vi.fn(),
}));
vi.mock("node:crypto", () => ({ createHash: () => ({ update: () => ({ digest: () => "961c8c1f7a309730fa18b84de4a2b6b13064cdb51169dd0eaf7d79bb375ff2a0" }) }) }));
vi.mock("@/lib/db", () => ({ db: {
  checkoutSession: { findMany: mocks.sessions }, order: { findFirst: mocks.order },
  emailMessage: { findUnique: mocks.existing, create: mocks.claim, update: mocks.update },
} }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ provider: "ses", from: "Shop <shop@example.com>", replyTo: "support@example.com" }) }));
vi.mock("@/lib/email/tracking", () => ({ isEmailSuppressed: mocks.suppressed }));
vi.mock("@/lib/email/transport", () => ({ dispatch: mocks.dispatch }));
import { incidentSendingClosed, sendIncidentNotice } from "@/lib/email/incident-20261018";

describe("one-time checkout incident service notice", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T11:00:00Z"));
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.sessions.mockResolvedValue([{ guestEmail: "buyer@example.com", user: null }]);
    mocks.order.mockResolvedValue(null);
    mocks.existing.mockResolvedValue(null);
    mocks.suppressed.mockResolvedValue(false);
    mocks.claim.mockResolvedValue({ id: "message-1" });
    mocks.update.mockResolvedValue({});
    mocks.dispatch.mockResolvedValue({ ok: true, id: "provider-1" });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it.each(["order", "suppression", "previous attempt"])("does not send after %s", async (reason) => {
    if (reason === "order") mocks.order.mockResolvedValue({ number: "SPC-EXISTING" });
    if (reason === "suppression") mocks.suppressed.mockResolvedValue(true);
    if (reason === "previous attempt") mocks.existing.mockResolvedValue({ status: "QUEUED" });
    await sendIncidentNotice("buyer@example.com", "admin");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("claims before sending, records provider acceptance and never alters consent", async () => {
    await sendIncidentNotice("buyer@example.com", "admin");
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispatch.mock.invocationCallOrder[0]);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ to: "buyer@example.com", replyTo: "support@example.com" }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", providerMessageId: "provider-1" }) }));
    expect(mocks.claim.mock.calls[0][0].data).not.toHaveProperty("recoveryConsent");
  });
  it("records provider rejection without claiming success", async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, error: "rejected" });
    await sendIncidentNotice("buyer@example.com", "admin");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED", error: "rejected" } }));
  });
  it("cannot send outside production or after the incident window", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(incidentSendingClosed()).toBe(true);
    await expect(sendIncidentNotice("buyer@example.com", "admin")).rejects.toThrow();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.setSystemTime(new Date("2026-10-18T22:00:00Z"));
    await expect(sendIncidentNotice("buyer@example.com", "admin")).rejects.toThrow();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
