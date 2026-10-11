import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ subscribe: vi.fn(), session: vi.fn(), user: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/email/restock", () => ({ subscribeToRestock: mock.subscribe }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mock.session }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mock.user } } }));
vi.mock("@/lib/security/rate-limit", () => ({ RATE_LIMITS: { newsletter: {} }, checkRateLimitForRequest: mock.rate, rateLimitJson: () => Response.json({}, { status: 429 }) }));
import { POST } from "@/app/api/restock/route";
const request = (data: unknown, origin = "https://www.svetpovoljnihcena.rs") => new Request("https://www.svetpovoljnihcena.rs/api/restock", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(data) });
describe("restock signup", () => {
  beforeEach(() => { vi.resetAllMocks(); mock.rate.mockResolvedValue({ ok: true }); mock.session.mockResolvedValue(null); });
  it("accepts a guest address with specific-product consent", async () => {
    expect((await POST(request({ sku: "110145", email: "guest@example.test" }))).status).toBe(200);
    expect(mock.subscribe).toHaveBeenCalledWith("110145", "guest@example.test", undefined);
  });
  it("uses the signed-in account rather than a submitted address", async () => {
    mock.session.mockResolvedValue({ id: "u", userType: "customer" });
    mock.user.mockResolvedValue({ id: "u", email: "owner@example.test", deletedAt: null });
    expect((await POST(request({ sku: "110145", email: "someone@example.test" }))).status).toBe(200);
    expect(mock.subscribe).toHaveBeenCalledWith("110145", "owner@example.test", "u");
  });
  it("rejects invalid addresses and cross-origin submissions", async () => {
    expect((await POST(request({ sku: "110145", email: "invalid" }))).status).toBe(400);
    expect((await POST(request({ sku: "110145", email: "guest@example.test" }, "https://other.test"))).status).toBe(403);
    expect(mock.subscribe).not.toHaveBeenCalled();
  });
  it("honors throttling and the spam trap", async () => {
    expect((await POST(request({ sku: "110145", email: "guest@example.test", website: "spam" }))).status).toBe(200);
    mock.rate.mockResolvedValue({ ok: false });
    expect((await POST(request({ sku: "110145", email: "guest@example.test" }))).status).toBe(429);
    expect(mock.subscribe).not.toHaveBeenCalled();
  });
});
