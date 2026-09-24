import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ accept: vi.fn(), member: vi.fn(), eligible: vi.fn() }));
vi.mock("@/lib/loyalty/service.server", () => ({ acceptLoyaltyConsent: mocks.accept, LOYALTY_COOKIE: "spc_guest_loyalty", LOYALTY_SESSION_SECONDS: 2592000 }));
vi.mock("@/lib/loyalty/session.server", () => ({ getGuestLoyaltyMember: mocks.member }));
vi.mock("@/lib/checkout/first-purchase.server", () => ({ isFirstPurchaseDiscountEligible: mocks.eligible }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimitForRequest: vi.fn().mockResolvedValue({ ok: true }), rateLimitJson: vi.fn(), RATE_LIMITS: { passwordReset: {}, checkoutOrder: {} } }));
import { POST as accept } from "@/app/api/loyalty/request/route";
import { POST as eligibility } from "@/app/api/loyalty/eligibility/route";
import { LOYALTY_CONSENT_VERSION } from "@/lib/loyalty/shared";
function request(body: object, origin = "https://example.com") {
  return new Request("https://example.com/api/loyalty/request", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
describe("guest loyalty consent API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.accept.mockResolvedValue("a".repeat(64)); mocks.member.mockResolvedValue({ email: null }); mocks.eligible.mockResolvedValue(true); });
  it("accepts explicit current consent without email and sets a secure HttpOnly session", async () => {
    const response = await accept(request({ consent: true, consentVersion: LOYALTY_CONSENT_VERSION }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.accept).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
  it.each([{ consent: false, consentVersion: LOYALTY_CONSENT_VERSION }, { consent: true, consentVersion: "old" }, {}])("rejects absent or stale consent: %j", async (body) => {
    expect((await accept(request(body))).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("rejects cross-site activation", async () => {
    expect((await accept(request({ consent: true, consentVersion: LOYALTY_CONSENT_VERSION }, "https://other.com"))).status).toBe(403);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("looks up the entered email only after server consent, without marking it verified", async () => {
    const response = await eligibility(request({ email: " Buyer@Example.com " }));
    expect(await response.json()).toEqual({ firstPurchase: true });
    expect(mocks.eligible).toHaveBeenCalledWith(null, "buyer@example.com");
    mocks.member.mockResolvedValue(null);
    mocks.eligible.mockClear();
    expect((await eligibility(request({ email: "buyer@example.com" }))).status).toBe(403);
    expect(mocks.eligible).not.toHaveBeenCalled();
  });
});
