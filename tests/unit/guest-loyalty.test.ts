import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { loyaltySavings } from "@/lib/loyalty/shared";

const { tx } = vi.hoisted(() => ({ tx: {
  verificationToken: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  guestLoyaltyMembership: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
} }));
vi.mock("@/lib/db", () => ({ db: { ...tx, $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } }));
import { confirmLoyalty, loyaltyMemberForSession, requestLoyaltyConfirmation } from "@/lib/loyalty/service.server";

const token = "a".repeat(64);
describe("email-only loyalty", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tx.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("stores only a digest of the confirmation token and normalizes identity", async () => {
    const { token: raw, browserSession } = await requestLoyaltyConfirmation(" Buyer@Example.com ");
    expect(raw).toMatch(/^[a-f0-9]{64}$/);
    expect(browserSession).not.toBe(raw);
    expect(tx.verificationToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ identifier: `loyalty-pending:${createHash("sha256").update(raw).digest("hex")}`, token: createHash("sha256").update(browserSession).digest("hex") }) });
    expect(tx.verificationToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      identifier: "loyalty-confirm:buyer@example.com",
      token: createHash("sha256").update(raw).digest("hex"),
    }) });
    expect(tx.guestLoyaltyMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "buyer@example.com" } }));
  });

  it("rejects malformed, expired and wrong-purpose links without creating membership sessions", async () => {
    expect(await confirmLoyalty("bad")).toBeNull();
    expect(tx.verificationToken.findUnique).not.toHaveBeenCalled();
    tx.verificationToken.findUnique.mockResolvedValue({ token, identifier: "loyalty-confirm:a@b.com", expires: new Date(0) });
    expect(await confirmLoyalty(token)).toBeNull();
    tx.verificationToken.findUnique.mockResolvedValue({ token, identifier: "pwreset:user", expires: new Date(Date.now() + 60_000) });
    expect(await confirmLoyalty(token)).toBeNull();
    expect(tx.verificationToken.create).not.toHaveBeenCalled();
  });

  it("claims a confirmation once and creates a separate limited loyalty session", async () => {
    tx.verificationToken.findUnique.mockResolvedValue({ token, identifier: "loyalty-confirm:a@b.com", expires: new Date(Date.now() + 60_000) });
    const session = await confirmLoyalty(token);
    expect(session).toMatch(/^[a-f0-9]{64}$/);
    expect(session).not.toBe(token);
    expect(tx.verificationToken.updateMany).toHaveBeenCalledWith({ where: { identifier: `loyalty-pending:${token}`, expires: { gt: expect.any(Date) } }, data: { identifier: "loyalty-session:a@b.com", expires: expect.any(Date) } });
    expect(tx.guestLoyaltyMembership.update).toHaveBeenCalledWith({ where: { email: "a@b.com" }, data: { verifiedAt: expect.any(Date) } });
    expect(tx.verificationToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ identifier: "loyalty-session:a@b.com" }) });
    tx.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    expect(await confirmLoyalty(token)).toBeNull();
    expect(tx.verificationToken.create).toHaveBeenCalledTimes(1);
  });

  it("does not treat an unverified membership or confirmation token as an active session", async () => {
    tx.verificationToken.findUnique.mockResolvedValue({ identifier: `loyalty-pending:${token}`, expires: new Date(Date.now() + 60_000) });
    expect(await loyaltyMemberForSession(token)).toBeNull();
    tx.verificationToken.findUnique.mockResolvedValue({ identifier: "loyalty-confirm:a@b.com", expires: new Date(Date.now() + 60_000) });
    expect(await loyaltyMemberForSession(token)).toBeNull();
    tx.verificationToken.findUnique.mockResolvedValue({ identifier: "loyalty-session:a@b.com", expires: new Date(Date.now() + 60_000) });
    tx.guestLoyaltyMembership.findUnique.mockResolvedValue({ email: "a@b.com", verifiedAt: null });
    expect(await loyaltyMemberForSession(token)).toBeNull();
    tx.guestLoyaltyMembership.findUnique.mockResolvedValue({ email: "a@b.com", verifiedAt: new Date() });
    expect(await loyaltyMemberForSession(token)).toEqual(expect.objectContaining({ email: "a@b.com" }));
  });

  it("shows only additional loyalty savings and respects quantities, sale exclusions and active prices", () => {
    expect(loyaltySavings([
      { qty: 2, unitPriceSale: 1000, unitPriceLoyalty: 700 },
      { qty: 3, unitPriceSale: 500 },
      { qty: 1, unitPriceSale: 700, unitPriceLoyalty: 700 },
      { qty: 1, unitPriceSale: 600, unitPriceLoyalty: 700 },
    ])).toBe(600);
    expect(loyaltySavings([])).toBe(0);
  });

  it("activates the requesting browser after confirmation elsewhere, but not an unrelated pending browser", async () => {
    type Record = { identifier: string; token: string; expires: Date };
    const records = new Map<string, Record>();
    tx.verificationToken.create.mockImplementation(({ data }: { data: Record }) => { records.set(data.token, data); return data; });
    tx.verificationToken.findUnique.mockImplementation(({ where }: { where: { token: string } }) => records.get(where.token));
    tx.verificationToken.deleteMany.mockImplementation(({ where }: { where: { token?: string; identifier?: string } }) => {
      let count = 0;
      for (const [key, value] of records) if (where.token ? key === where.token : value.identifier === where.identifier) { records.delete(key); count++; }
      return { count };
    });
    tx.verificationToken.updateMany.mockImplementation(({ where, data }: { where: { identifier: string; expires: { gt: Date } }; data: Partial<Record> }) => {
      for (const record of records.values()) if (record.identifier === where.identifier && record.expires > where.expires.gt) Object.assign(record, data);
      return { count: 1 };
    });
    tx.guestLoyaltyMembership.findUnique.mockResolvedValue({ email: "buyer@example.com", verifiedAt: new Date() });
    const first = await requestLoyaltyConfirmation("buyer@example.com");
    expect(await loyaltyMemberForSession(first.browserSession)).toBeNull();
    const replacement = await requestLoyaltyConfirmation("buyer@example.com");
    expect(await confirmLoyalty(first.token)).toBeNull();
    const emailBrowserSession = await confirmLoyalty(replacement.token);
    expect(await loyaltyMemberForSession(replacement.browserSession)).toEqual(expect.objectContaining({ email: "buyer@example.com" }));
    expect(await loyaltyMemberForSession(emailBrowserSession!)).toEqual(expect.objectContaining({ email: "buyer@example.com" }));
    expect(await loyaltyMemberForSession(first.browserSession)).toBeNull();
    expect(await confirmLoyalty(replacement.token)).toBeNull();
  });
});
