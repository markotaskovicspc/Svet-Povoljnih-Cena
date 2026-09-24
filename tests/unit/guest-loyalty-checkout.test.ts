import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), createOrder: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/loyalty/session.server", () => ({ getGuestLoyaltyMember: mocks.member }));
vi.mock("@/lib/api/checkout", () => ({
  createOrder: mocks.createOrder,
  createOrderSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimitForRequest: vi.fn().mockResolvedValue({ ok: true }),
  rateLimitJson: vi.fn(), RATE_LIMITS: { checkoutOrder: {} },
}));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: vi.fn() }));
vi.mock("@/lib/checkout/outbox", () => ({ checkoutFollowUpKey: vi.fn() }));
import { POST } from "@/app/api/checkout/order/route";
import { computeTotals } from "@/components/checkout/order-summary";

function request(body: object) {
  return new Request("https://example.com/api/checkout/order", { method: "POST", body: JSON.stringify({ lines: [], ...body }) });
}

describe("guest loyalty checkout trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue(null);
    mocks.member.mockResolvedValue(null);
    mocks.createOrder.mockResolvedValue({ ok: false, error: { code: "EMPTY_CART" } });
  });
  it("rejects a client loyalty flag without a server consent session", async () => {
    const response = await POST(request({ guestEmail: "a@b.com", guestLoyalty: true }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "LOYALTY_CONSENT_REQUIRED" } });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("requires an email at checkout even after accepting consent", async () => {
    mocks.member.mockResolvedValue({ email: null, consentVersion: "v3", consentAt: new Date() });
    await POST(request({ guestLoyalty: true }));
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("binds anonymous server consent to the email entered at checkout", async () => {
    const member = { email: null, consentVersion: "v3", consentAt: new Date() };
    mocks.member.mockResolvedValue(member);
    await POST(request({ guestEmail: "A@B.COM", guestLoyalty: true }));
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({ guestLoyalty: true }), null, { ...member, email: "a@b.com" });
  });
  it("keeps ordinary guests eligible for checkout without membership", async () => {
    await POST(request({ guestEmail: "a@b.com" }));
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.anything(), null, null);
  });
  it("does not apply a guest identity on top of an authenticated account", async () => {
    mocks.user.mockResolvedValue({ id: "customer", userType: "customer" });
    await POST(request({ guestLoyalty: true }));
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.anything(), "customer", null);
  });
  it("applies 15% after the loyalty price and excludes shipping from this discount", () => {
    const totals = computeTotals({ itemsFull: 10_000, itemsSale: 7_000,
      shippingMethod: "kurir", shippingPrices: { kurir: 500, kamion: null },
      assemblyTotal: 0, voucherDiscountRsd: 0, firstPurchaseEligible: true });
    expect(totals.firstPurchaseDiscount).toBe(1050);
    expect(totals.total).toBe(6450);
  });
});
