import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { EXIT_INTENT_CAMPAIGN, exitIntentEventId, exitIntentPathAllowed, isTopExit } from "@/lib/analytics/exit-intent";
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), eligible: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { analyticsEvent: { create: mocks.create } } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/checkout/first-purchase.server", () => ({ isFirstPurchaseDiscountEligible: mocks.eligible }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimitForRequest: async () => ({ ok: true }), rateLimitJson: vi.fn() }));
import { POST } from "@/app/api/analytics/events/route";
import { GET } from "@/app/api/marketing/first-purchase-offer/route";
const metadata = () => ({ campaign: EXIT_INTENT_CAMPAIGN, exposureId: randomUUID(), event: "impression" as const, discountPct: 10, audience: "guest" as const });
function request(meta: unknown, consent = "analytics", extra = {}) {
  return new Request("https://shop.test/api/analytics/events", { method: "POST", headers: { cookie: `spc_cookie_consent=${consent}`, "content-type": "application/json" }, body: JSON.stringify({ type: "EXIT_INTENT", anonymousId: "v2:browser", sessionId: "session", consentVersion: "2026-08", path: "/korpa?email=private@example.test#section", metadata: meta, ...extra }) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ id: "test" }); });
it("requires real top exit, desktop, dwell and cooldown; excludes internal mouse transitions", () => {
  const input = { clientY: 0, relatedTarget: null, pointerUsed: true, visible: true, desktop: true, elapsedMs: 15_000, closedUntil: 0, now: 100_000 };
  expect(isTopExit(input)).toBe(true);
  for (const change of [{ clientY: 20 }, { relatedTarget: {} }, { pointerUsed: false }, { visible: false }, { desktop: false }, { elapsedMs: 14_999 }, { closedUntil: 100_001 }]) expect(isTopExit({ ...input, ...change })).toBe(false);
});
it("never interrupts admin, account, verification or checkout; allows catalog and cart", () => {
  for (const path of ["/admin", "/admin/erp", "/nalog/registracija", "/checkout/podaci", "/checkout/potvrda", "/loyalty/potvrda", "/api/x"]) expect(exitIntentPathAllowed(path)).toBe(false);
  for (const path of ["/", "/p/stolica", "/k/stolice", "/korpa"]) expect(exitIntentPathAllowed(path)).toBe(true);
});
it("consent is required and exit events cannot become page views or purchases", async () => {
  expect((await POST(request(metadata(), "essential"))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
  expect((await POST(request({ ...metadata(), event: "purchase" }))).status).toBe(400);
  expect((await POST(request(metadata(), "analytics", { type: "CHECKOUT_COMPLETED" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("stores a strict, deduplicated event and strips query data", async () => {
  const meta = metadata();
  expect((await POST(request(meta))).status).toBe(201);
  expect(mocks.create.mock.calls[0][0].data).toMatchObject({ id: exitIntentEventId(meta), type: "EXIT_INTENT", path: "/korpa", metadata: meta, productId: null });
  mocks.create.mockRejectedValue({ code: "P2002" });
  const retry = await POST(request(meta));
  expect(await retry.json()).toEqual({ ok: true, id: exitIntentEventId(meta) });
});
it("rejects arbitrary metadata, invalid IDs, spoofed sales values and unknown campaign", async () => {
  for (const meta of [{ ...metadata(), email: "private" }, { ...metadata(), exposureId: "bad" }, { ...metadata(), campaign: "other" }]) expect((await POST(request(meta))).status).toBe(400);
  expect((await POST(request(metadata(), "analytics", { value: 5000 }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("uses signed-in customer purchase eligibility and never treats guest email as an account", async () => {
  const req = new Request("https://shop.test/api/marketing/first-purchase-offer?email=existing@example.test");
  mocks.user.mockResolvedValue(null);
  expect(await (await GET(req)).json()).toEqual({ eligible: true });
  expect(mocks.eligible).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ id: "admin", userType: "admin" });
  expect(await (await GET(req)).json()).toEqual({ eligible: false });
  mocks.user.mockResolvedValue({ id: "customer", userType: "customer" });
  mocks.eligible.mockResolvedValue(false);
  expect(await (await GET(req)).json()).toEqual({ eligible: false });
  expect(mocks.eligible).toHaveBeenCalledWith("customer");
  mocks.eligible.mockResolvedValue(true);
  const response = await GET(req);
  expect(await response.json()).toEqual({ eligible: true });
  expect(response.headers.get("cache-control")).toContain("no-store");
});
