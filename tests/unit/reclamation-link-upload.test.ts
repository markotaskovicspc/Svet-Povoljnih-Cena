import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ order: vi.fn(), presign: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: m.order } } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/api/uploads", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api/uploads")>(), presignUpload: m.presign,
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimitForRequest: async () => ({ ok: true }), RATE_LIMITS: { upload: {} }, rateLimitJson: vi.fn(),
}));
import { POST } from "@/app/api/reclamations/upload/route";
import { createReclamationLinkToken, RECLAMATION_LINK_TTL_MS } from "@/lib/api/reclamation-link-token";
const order = { number: "SPC-1", userId: "buyer", publicAccessTokenHash: null, items: [{ sku: "SKU" }] };
function request(token?: string) {
  return new Request("https://example.test/api/reclamations/upload", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-order-access-token": token } : {}) },
    body: JSON.stringify({ filename: "problem.jpg", contentType: "image/jpeg", bytes: 1024, orderNumberOrFiscal: order.number, sku: "SKU" }),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ORDER_ACCESS_TOKEN_SECRET", "test-private-secret");
  m.order.mockResolvedValue(order); m.user.mockResolvedValue(null);
  m.presign.mockResolvedValue({ uploadUrl: "https://example.test/private-upload", key: "private-key" });
});
afterEach(() => vi.unstubAllEnvs());
it("allows private photo upload from a staff link without a customer session", async () => {
  const { token } = createReclamationLinkToken(order.number);
  expect((await POST(request(token))).status).toBe(200);
  expect(m.presign).toHaveBeenCalledWith(expect.anything(), { orderNumber: order.number, sku: "SKU" });
});
it("still accepts the link if a different customer is logged in", async () => {
  m.user.mockResolvedValue({ id: "other-buyer", userType: "customer" });
  expect((await POST(request(createReclamationLinkToken(order.number).token))).status).toBe(200);
});
it("rejects absent, expired, altered and other-order links before opening storage", async () => {
  const { token } = createReclamationLinkToken(order.number);
  const expired = createReclamationLinkToken(order.number, Date.now() - RECLAMATION_LINK_TTL_MS - 1000).token;
  for (const invalid of [undefined, expired, token + "x", createReclamationLinkToken("SPC-OTHER").token]) {
    expect((await POST(request(invalid))).status).toBe(403);
  }
  expect(m.presign).not.toHaveBeenCalled();
});
