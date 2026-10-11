import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";

const mocks = vi.hoisted(() => ({
  config: null as NextAuthConfig | null,
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => {
  mocks.config = config;
  return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
} }));
vi.mock("@/lib/db", () => ({ db: { user: { findFirst: mocks.findFirst, updateMany: mocks.updateMany }, $transaction: mocks.transaction } }));
vi.mock("@/lib/customer-master-sync.server", () => ({ syncRegisteredCustomer: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: vi.fn(), rateLimitKey: vi.fn(), RATE_LIMITS: {} }));

beforeAll(async () => {
  for (const provider of ["GOOGLE", "FACEBOOK", "APPLE"]) {
    vi.stubEnv(`${provider}_CLIENT_ID`, "test-client");
    vi.stubEnv(`${provider}_CLIENT_SECRET`, "test-secret");
  }
  await import("@/lib/auth/auth");
  vi.unstubAllEnvs();
});

describe("social login configuration", () => {
  it.each(["facebook", "google", "apple"])("enables automatic same-email linking for %s", (id) => {
    const provider = mocks.config!.providers.find((p) => typeof p !== "function" && p.id === id) as { options: { allowDangerousEmailAccountLinking?: boolean } };
    expect(provider.options.allowDangerousEmailAccountLinking).toBe(true);
  });

  it("rejects unverified Google email before linking", async () => {
    const signIn = mocks.config!.callbacks!.signIn!;
    expect(await signIn({ user: { id: "google-user", email: "customer@example.com" }, account: { provider: "google" }, profile: { email_verified: false } } as never)).toBe(false);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("blocks a soft-deleted customer found by email before automatic linking", async () => {
    mocks.findFirst.mockResolvedValue({ deletedAt: new Date() });
    const signIn = mocks.config!.callbacks!.signIn!;
    expect(await signIn({ user: { id: "facebook-id", email: "customer@example.com" }, account: { provider: "facebook" } } as never)).toBe(false);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ id: "facebook-id" }, { email: "customer@example.com" }] } }));
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

// Exercise the installed Auth.js linking handler, not a reimplementation.
const handlerUrl = new URL("../../node_modules/@auth/core/lib/actions/callback/handle-login.js", import.meta.url).href;

describe("Auth.js customer identity across social login", () => {
  it.each(["facebook", "google", "apple"])("keeps the existing customer ID when entering through %s", async (provider) => {
    const { handleLoginOrRegister } = await import(handlerUrl);
    const existing = { id: "existing-customer", email: "customer@example.com" };
    const linkAccount = vi.fn();
    const createUser = vi.fn();
    const result = await handleLoginOrRegister(null, { id: "social-id", email: existing.email },
      { provider, providerAccountId: "social-id", type: "oauth" }, {
        adapter: { getUserByAccount: vi.fn().mockResolvedValue(null), getUserByEmail: vi.fn().mockResolvedValue(existing), linkAccount, createUser },
        session: { strategy: "jwt" }, jwt: {}, events: {},
        provider: { allowDangerousEmailAccountLinking: true, account: () => ({}) },
      });
    expect(result.user.id).toBe(existing.id);
    expect(result.isNewUser).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
    expect(linkAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: existing.id, provider }));
  });

  it("creates a customer automatically on first social login when email is new", async () => {
    const { handleLoginOrRegister } = await import(handlerUrl);
    const createUser = vi.fn().mockResolvedValue({ id: "new-customer", email: "new@example.com" });
    const linkAccount = vi.fn();
    const result = await handleLoginOrRegister(null, { email: "new@example.com" },
      { provider: "facebook", providerAccountId: "new-social-id", type: "oauth" }, {
        adapter: { getUserByAccount: vi.fn().mockResolvedValue(null), getUserByEmail: vi.fn().mockResolvedValue(null), createUser, linkAccount },
        session: { strategy: "jwt" }, jwt: {}, events: {},
        provider: { allowDangerousEmailAccountLinking: true, account: () => ({}) },
      });
    expect(result.user.id).toBe("new-customer");
    expect(result.isNewUser).toBe(true);
    expect(linkAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: "new-customer" }));
  });
});
