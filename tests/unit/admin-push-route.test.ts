import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), find: vi.fn(), save: vi.fn(), remove: vi.fn(), update: vi.fn(), config: vi.fn(), send: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mocks.admin }));
vi.mock("@/lib/db", () => ({ db: { adminPushSubscription: { findFirst: mocks.find, upsert: mocks.save, deleteMany: mocks.remove, updateMany: mocks.update } } }));
vi.mock("@/lib/admin/order-push.server", () => ({ getPushConfiguration: mocks.config, sendAdminDevicePush: mocks.send }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: mocks.limit, rateLimitJson: () => new Response(null, { status: 429 }) }));
import { GET, POST } from "@/app/api/admin/push/route";

const endpoint = "https://web.push.apple.com/device";
const subscription = { endpoint, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };
function request(data: unknown, origin = "https://shop.example") {
  return new Request("https://shop.example/api/admin/push", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "admin1", role: "OPS" });
  mocks.config.mockReturnValue({ publicKey: "public", privateKey: "private", subject: "subject" });
  mocks.limit.mockResolvedValue({ ok: true });
  mocks.send.mockResolvedValue(true);
});
it("exposes only the public key and never caches configuration", async () => {
  const response = await GET();
  expect(await response.json()).toEqual({ configured: true, publicKey: "public" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("rejects unauthenticated users, unauthorized roles and cross-origin mutations", async () => {
  for (const admin of [null, { id: "admin1", role: "CONTENT" }]) {
    mocks.admin.mockResolvedValue(admin);
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ operation: "subscribe", subscription }))).status).toBe(403);
  }
  expect((await POST(request({ operation: "subscribe", subscription }, "https://attacker.example"))).status).toBe(403);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("validates subscription endpoints and rejects missing server configuration", async () => {
  expect((await POST(request({ operation: "subscribe", subscription: { ...subscription, endpoint: "https://localhost/private" } }))).status).toBe(400);
  mocks.config.mockReturnValue(null);
  expect((await POST(request({ operation: "subscribe", subscription }))).status).toBe(503);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("binds the subscription to the session and scopes status, test and deletion to its owner", async () => {
  expect((await POST(request({ operation: "subscribe", subscription, adminUserId: "attacker" }))).status).toBe(200);
  expect(mocks.save.mock.calls[0][0].create.adminUserId).toBe("admin1");
  mocks.find.mockResolvedValue(null);
  expect((await POST(request({ operation: "test", endpoint }))).status).toBe(404);
  expect(mocks.find).toHaveBeenCalledWith({ where: { endpoint, adminUserId: "admin1" }, select: { id: true } });
  expect(mocks.send).not.toHaveBeenCalled();
  expect((await POST(request({ operation: "unsubscribe", endpoint }))).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith({ where: { endpoint, adminUserId: "admin1" } });
});

it('scopes traffic-alert opt-in to the authenticated device owner',async()=>{
 mocks.update.mockResolvedValue({count:1});
 expect((await POST(request({operation:'preferences',endpoint,trafficAlerts:true}))).status).toBe(200);
 expect(mocks.update).toHaveBeenCalledWith({where:{endpoint,adminUserId:'admin1'},data:{trafficAlerts:true}});
 mocks.update.mockResolvedValue({count:0});
 expect((await POST(request({operation:'preferences',endpoint,trafficAlerts:true}))).status).toBe(404);
});
