import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loaded: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/auth/session", () => {
  mocks.loaded();
  return { getCurrentUser: mocks.user };
});
import { canAccessOrder, createOrderAccessToken, hashOrderAccessToken, verifyOrderAccessToken } from "@/lib/api/order-access";

it("generates and verifies email tokens without loading request authentication", () => {
  const token = createOrderAccessToken();
  expect(verifyOrderAccessToken({ token, tokenHash: hashOrderAccessToken(token) })).toBe(true);
  expect(mocks.loaded).not.toHaveBeenCalled();
});

it("still checks authenticated ownership and exact guest tokens at the request boundary", async () => {
  const token = createOrderAccessToken();
  const order = { userId: "buyer", publicAccessTokenHash: hashOrderAccessToken(token) };
  mocks.user.mockResolvedValue({ id: "buyer", userType: "customer" });
  expect(await canAccessOrder({ order })).toBe(true);
  mocks.user.mockResolvedValue({ id: "another-buyer", userType: "customer" });
  expect(await canAccessOrder({ order })).toBe(false);
  mocks.user.mockResolvedValue(null);
  expect(await canAccessOrder({ order, token })).toBe(true);
  expect(await canAccessOrder({ order, token: "wrong-token" })).toBe(false);
  expect(mocks.loaded).toHaveBeenCalledOnce();
});
