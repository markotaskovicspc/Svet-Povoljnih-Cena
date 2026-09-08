import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sessions: vi.fn(), order: vi.fn(), existing: vi.fn(), create: vi.fn(), update: vi.fn(),
  suppressed: vi.fn(), dispatch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  checkoutSession: { findMany: mocks.sessions }, order: { findFirst: mocks.order },
  emailMessage: { findUnique: mocks.existing, create: mocks.create, update: mocks.update },
} }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ provider: "ses", replyTo: "office@example.test" }) }));
vi.mock("@/lib/email/tracking", () => ({ isEmailSuppressed: mocks.suppressed }));
vi.mock("@/lib/email/transport", () => ({ dispatch: mocks.dispatch }));
import { incidentRecipients, sendIncidentNotice } from "@/lib/email/incident-20260908";

// The incident allowlist is intentionally immutable; use one approved address.
const email = "dam9984@gmail.com";
describe("one-time incident service notices", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-08T17:20:00Z"));
    mocks.sessions.mockResolvedValue([{ guestEmail: email, user: null }, { guestEmail: email, user: null }]);
    mocks.order.mockResolvedValue(null);
    mocks.existing.mockResolvedValue(null);
    mocks.suppressed.mockResolvedValue(false);
    mocks.create.mockResolvedValue({ id: "notice" });
    mocks.dispatch.mockResolvedValue({ ok: true, id: "ses-message", provider: "ses" });
  });
  it("deduplicates sessions and excludes addresses outside the approved list", async () => {
    mocks.sessions.mockResolvedValue([{ guestEmail: email }, { guestEmail: email }, { guestEmail: "unapproved@example.test" }]);
    expect((await incidentRecipients()).map(r => r.email)).toEqual([email]);
    await expect(sendIncidentNotice("unapproved@example.test", "admin")).rejects.toThrow("odobren");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("skips newly purchased, suppressed, and previously attempted recipients", async () => {
    mocks.order.mockResolvedValueOnce({ number: "SPC-new" });
    await sendIncidentNotice(email, "admin");
    mocks.suppressed.mockResolvedValueOnce(true);
    await sendIncidentNotice(email, "admin");
    mocks.existing.mockResolvedValueOnce({ status: "QUEUED" });
    await sendIncidentNotice(email, "admin");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("persists the claim before sending and records the provider ID", async () => {
    await sendIncidentNotice(email, "admin");
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispatch.mock.invocationCallOrder[0]);
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ to: email, replyTo: "office@example.test" }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", providerMessageId: "ses-message" }) }));
  });
  it("does not send if the durable claim cannot be saved", async () => {
    mocks.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(sendIncidentNotice(email, "admin")).rejects.toThrow("database unavailable");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("closes sending after the incident window and outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(sendIncidentNotice(email, "admin")).rejects.toThrow("zatvoreno");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-09T00:00:00Z"));
    await expect(sendIncidentNotice(email, "admin")).rejects.toThrow("zatvoreno");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
