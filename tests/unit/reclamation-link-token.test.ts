import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReclamationLinkToken, verifyReclamationLinkToken, RECLAMATION_LINK_TTL_MS } from "@/lib/api/reclamation-link-token";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
import { canAccessReclamationOrder, createReclamationSchema } from "@/lib/api/reclamations";
import { hashOrderAccessToken } from "@/lib/api/order-access";

beforeEach(() => { vi.stubEnv("AUTH_SECRET", "private-test-secret"); vi.stubEnv("ORDER_ACCESS_TOKEN_SECRET", ""); vi.stubEnv("NEXTAUTH_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("staff reclamation links", () => {
  it("grants only the exact order for seven days and rejects tampering", () => {
    const now = 1000000;
    const { token, expiresAt } = createReclamationLinkToken("SPC-1", now);
    expect(expiresAt).toBe(now + RECLAMATION_LINK_TTL_MS);
    expect(verifyReclamationLinkToken(token, "SPC-1", now)).toBe(true);
    expect(verifyReclamationLinkToken(token, "SPC-2", now)).toBe(false);
    expect(verifyReclamationLinkToken(token, "SPC-1", expiresAt)).toBe(false);
    expect(verifyReclamationLinkToken(token + "x", "SPC-1", now)).toBe(false);
    expect(verifyReclamationLinkToken(token + ".extra", "SPC-1", now)).toBe(false);
  });
  it("works for account and guest orders without rotating their existing access token", () => {
    const { token } = createReclamationLinkToken("SPC-1");
    const order = { number: "SPC-1", userId: "customer", publicAccessTokenHash: hashOrderAccessToken("old-token") };
    expect(canAccessReclamationOrder(order, token)).toBe(true);
    expect(canAccessReclamationOrder({ ...order, userId: null }, token)).toBe(true);
    expect(canAccessReclamationOrder(order, "old-token")).toBe(false);
    expect(canAccessReclamationOrder({ ...order, userId: null }, "old-token")).toBe(true);
    expect(canAccessReclamationOrder({ ...order, number: "SPC-2" }, token)).toBe(false);
  });
  it("rejects placeholder configuration rather than signing predictable links", () => {
    vi.stubEnv("AUTH_SECRET", "GET_FROM_CONFIGURATION");
    expect(() => createReclamationLinkToken("SPC-1")).toThrow(/nije podešena/);
    expect(verifyReclamationLinkToken("invalid", "SPC-1")).toBe(false);
  });
  it("accepts buyer problem and requested remedy but rejects internal decisions", () => {
    const input = { orderNumberOrFiscal: "SPC-1", sku: "SKU", quantity: 1, description: "Artikal ne radi", type: "KVAR", request: "POVRACAJ_NOVCA", decision: "PRIHVACENA" };
    const parsed = createReclamationSchema.parse(input);
    expect(parsed).toMatchObject({ type: "KVAR", request: "POVRACAJ_NOVCA" });
    expect(parsed).not.toHaveProperty("decision");
    expect(createReclamationSchema.safeParse({ ...input, request: "AUTOMATSKA_REFUNDACIJA" }).success).toBe(false);
  });
});
