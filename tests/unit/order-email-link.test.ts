import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: mocks.find, updateMany: mocks.update } } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
import { createCheckoutOrderAccessToken } from "@/lib/api/order-access";
import { orderLinkForEmail } from "@/lib/email/order-link";

const order = { id: "MP-2026-000123" };
const base = "https://www.svetpovoljnihcena.rs/";
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const guest = (tokenHash: string | null = null) => ({ userId: null, publicAccessTokenHash: tokenHash, checkoutSessions: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ORDER_ACCESS_TOKEN_SECRET", "");
  vi.stubEnv("AUTH_SECRET", "isolated-order-email-test-secret");
  vi.stubEnv("NEXTAUTH_SECRET", "");
  mocks.find.mockResolvedValue(guest());
  mocks.update.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it("links registered buyers to their authenticated order page without issuing guest access", async () => {
  expect(await orderLinkForEmail("internal", { ...order, userId: "customer" }, base))
    .toBe("https://www.svetpovoljnihcena.rs/nalog/porudzbine/MP-2026-000123");
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});

it("recovers the existing checkout token only after matching its stored hash", async () => {
  const token = createCheckoutOrderAccessToken("checkout-session");
  mocks.find.mockResolvedValue({ ...guest(hash(token)), checkoutSessions: [{ id: "checkout-session" }] });
  const url = new URL((await orderLinkForEmail("internal", order, base))!);
  expect(url.searchParams.get("order")).toBe(order.id);
  expect(url.searchParams.get("token")).toBe(token);
  expect(mocks.update).not.toHaveBeenCalled();
});

it("never rotates an existing unrecoverable guest token or emits a broken order link", async () => {
  mocks.find.mockResolvedValue(guest(hash("older-random-token")));
  expect(await orderLinkForEmail("internal", order, base)).toBeNull();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("initializes missing manual-guest access with a reusable token and stores only its hash", async () => {
  const first = await orderLinkForEmail("internal", order, base);
  const token = new URL(first!).searchParams.get("token")!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(mocks.update).toHaveBeenCalledWith({
    where: { id: "internal", userId: null, publicAccessTokenHash: null },
    data: { publicAccessTokenHash: hash(token), publicAccessTokenCreatedAt: expect.any(Date) },
  });
  mocks.find.mockResolvedValue(guest(hash(token)));
  expect(await orderLinkForEmail("internal", order, base)).toBe(first);
  expect(mocks.update).toHaveBeenCalledOnce();
});

it("does not replace a concurrent token issuance", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  mocks.find.mockResolvedValueOnce(guest()).mockResolvedValueOnce(guest(hash("concurrent-token")));
  expect(await orderLinkForEmail("internal", order, base)).toBeNull();
  expect(mocks.update).toHaveBeenCalledOnce();
});

it("accepts a concurrent identical initialization without another update", async () => {
  const first = await orderLinkForEmail("internal", order, base);
  const token = new URL(first!).searchParams.get("token")!;
  mocks.update.mockClear(); mocks.update.mockResolvedValue({ count: 0 });
  mocks.find.mockResolvedValueOnce(guest()).mockResolvedValueOnce(guest(hash(token)));
  expect(await orderLinkForEmail("internal", order, base)).toBe(first);
  expect(mocks.update).toHaveBeenCalledOnce();
});

it("does not create access with missing or placeholder secrets", async () => {
  vi.stubEnv("ORDER_ACCESS_TOKEN_SECRET", "GET_FROM_VERCEL"); vi.stubEnv("AUTH_SECRET", "GET_FROM_VERCEL");
  expect(await orderLinkForEmail("internal", order, base)).toBeNull();
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each([null, { ...guest(), userId: "newly-linked-customer" }])("does not initialize a missing or newly registered order", async record => {
  mocks.find.mockResolvedValue(record);
  expect(await orderLinkForEmail("internal", order, base)).toBeNull();
  expect(mocks.update).not.toHaveBeenCalled();
});
