import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(), subscriptions: vi.fn(), remove: vi.fn(), order: vi.fn(),
  enqueue: vi.fn(), process: vi.fn(), send: vi.fn(), configure: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  adminPushSubscription: { findUnique: mocks.find, findMany: mocks.subscriptions, deleteMany: mocks.remove },
  order: { findUnique: mocks.order },
} }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueue, processBackgroundJob: mocks.process }));
vi.mock("web-push", () => ({ default: { setVapidDetails: mocks.configure, sendNotification: mocks.send } }));
import { deliverOrderPush, fanOutOrderPush, getPushConfiguration, sendAdminDevicePush } from "@/lib/admin/order-push.server";
import { canReceiveOrderPush, isPushEndpoint, pushSubscriptionSchema } from "@/lib/admin/push-policy";
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VAPID_PUBLIC_KEY", "public");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private");
  vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
  mocks.find.mockResolvedValue({ id: "s1", adminUserId: "a1", endpoint: "https://web.push.apple.com/device", p256dh: "key", auth: "auth", adminUser: { enabled: true, role: "OPS" } });
  mocks.order.mockResolvedValue({ number: "SPC-123", createdAt: new Date() });
  mocks.subscriptions.mockResolvedValue([{ id: "s1", adminUserId: "a1" }, { id: "s2", adminUserId: "a2" }]);
  mocks.enqueue.mockImplementation(async ({ idempotencyKey }) => ({ id: idempotencyKey }));
  mocks.send.mockResolvedValue({ statusCode: 201 });
});

it("allows order staff only and blocks private/attacker endpoints", () => {
  expect(["SUPER", "OPS", "ADS", "CONTENT", null].map(canReceiveOrderPush)).toEqual([true, true, false, false, false]);
  for (const endpoint of ["https://web.push.apple.com/device", "https://fcm.googleapis.com/token", "https://updates.push.services.mozilla.com/token", "https://foo.notify.windows.com/token"]) expect(isPushEndpoint(endpoint)).toBe(true);
  for (const endpoint of ["http://fcm.googleapis.com/token", "https://127.0.0.1/token", "https://fcm.googleapis.com.attacker.com", "https://web.push.apple.com:444/token", "https://user:pass@web.push.apple.com/token"]) expect(isPushEndpoint(endpoint)).toBe(false);
  expect(pushSubscriptionSchema.safeParse({ endpoint: "https://web.push.apple.com/device", keys: { p256dh: "short", auth: "short" } }).success).toBe(false);
});

it("treats GET_FROM placeholders and invalid VAPID keys as unconfigured", () => {
  vi.stubEnv("VAPID_PRIVATE_KEY", "GET_FROM_VERCEL");
  expect(getPushConfiguration()).toBeNull();
  vi.stubEnv("VAPID_PRIVATE_KEY", "private");
  mocks.configure.mockImplementation(() => { throw new Error("Invalid key"); });
  expect(getPushConfiguration()).toBeNull();
});

it("queues per-device durable work with stable keys before contacting providers", async () => {
  const queuedCounts: number[] = [];
  mocks.process.mockImplementation(async () => { queuedCounts.push(mocks.enqueue.mock.calls.length); });
  await fanOutOrderPush("o1");
  await fanOutOrderPush("o1");
  expect(mocks.enqueue.mock.calls.map(([job]) => job.idempotencyKey)).toEqual([
    "admin-order-push:o1:s1", "admin-order-push:o1:s2", "admin-order-push:o1:s1", "admin-order-push:o1:s2",
  ]);
  expect(queuedCounts).toEqual([2, 2, 4, 4]);
  expect(mocks.subscriptions.mock.calls[0][0].where.adminUser).toEqual({ enabled: true, role: { in: ["SUPER", "OPS"] } });
});

it("never sends old orders, disabled users, removed permissions, or transferred subscriptions", async () => {
  mocks.order.mockResolvedValue({ createdAt: new Date(Date.now() - 3600_001) });
  await fanOutOrderPush("o1");
  expect(mocks.enqueue).not.toHaveBeenCalled();
  mocks.order.mockResolvedValue({ number: "SPC-123", createdAt: new Date() });
  await deliverOrderPush("o1", "s1", "different-admin");
  expect(mocks.send).not.toHaveBeenCalled();
  for (const adminUser of [{ enabled: false, role: "SUPER" }, { enabled: true, role: "CONTENT" }]) {
    mocks.find.mockResolvedValue({ adminUser });
    expect(await sendAdminDevicePush("s1", { title: "Test", body: "Test", url: "/admin", tag: "test" })).toBe(false);
  }
  expect(mocks.send).not.toHaveBeenCalled();
});

it("sends a private payload with a direct order link and bounded provider timeout", async () => {
  await deliverOrderPush("o1", "s1", "a1");
  const [, payload, options] = mocks.send.mock.calls[0];
  expect(JSON.parse(payload)).toEqual({ title: "Nova porudžbina SPC-123", body: "Otvorite administraciju za pregled porudžbine.", url: "/admin/erp/prodajni-nalozi/o1", tag: "order-o1" });
  expect(options).toMatchObject({ timeout: 10_000, TTL: 3600, urgency: "high" });
});

it("removes expired devices and leaves transient errors retryable without leaking endpoints", async () => {
  const payload = { title: "Test", body: "Test", url: "/admin", tag: "test" };
  mocks.send.mockRejectedValueOnce({ statusCode: 410 });
  expect(await sendAdminDevicePush("s1", payload)).toBe(false);
  expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "s1" } });
  mocks.send.mockRejectedValueOnce({ statusCode: 503, body: "private endpoint" });
  await expect(sendAdminDevicePush("s1", payload)).rejects.toThrow("Push delivery failed (503)");
  expect(mocks.remove).toHaveBeenCalledTimes(1);
});
