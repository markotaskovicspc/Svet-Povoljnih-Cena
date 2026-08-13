import { describe, expect, it } from "vitest";
import {
  pinE2EDatabaseAliases,
  requireSafeE2EDatabase,
} from "../helpers/e2e-database-safety";

describe("E2E database safety", () => {
  it("does not require a database for read-only browser suites", () => {
    expect(requireSafeE2EDatabase({ E2E_LIVE_CATALOG: "1" })).toBeNull();
  });

  it("fails closed when a mutation suite has no explicit E2E URL", () => {
    expect(() =>
      requireSafeE2EDatabase({ E2E_ARTICLE_MASTER: "1" }),
    ).toThrow(/E2E_DATABASE_URL/);
  });

  it("accepts an isolated localhost QA database", () => {
    const url = "postgresql://postgres:secret@127.0.0.1:5432/spc_pricing_qa";
    expect(
      requireSafeE2EDatabase({
        E2E_ARTICLE_MASTER: "1",
        E2E_DATABASE_URL: url,
      }),
    ).toBe(url);
  });

  it("also validates explicit E2E URLs used by unflagged suites", () => {
    expect(
      requireSafeE2EDatabase({
        E2E_DATABASE_URL:
          "postgresql://postgres:secret@localhost:5432/auth_test",
      }),
    ).toContain("auth_test");
  });

  it("rejects production-like database names and unacknowledged remote URLs", () => {
    expect(() =>
      requireSafeE2EDatabase({
        E2E_ARTICLE_MASTER: "1",
        E2E_DATABASE_URL:
          "postgresql://postgres:secret@127.0.0.1:5432/svet_akcija",
      }),
    ).toThrow(/qa or test segment/);

    expect(() =>
      requireSafeE2EDatabase({
        E2E_ARTICLE_MASTER: "1",
        E2E_DATABASE_URL:
          "postgresql://postgres:secret@db.example.test:5432/spc_qa",
      }),
    ).toThrow(/Remote E2E mutations are disabled/);
  });

  it("requires a deliberate acknowledgement for remote QA writes", () => {
    const url = "postgresql://postgres:secret@db.example.test:5432/spc_qa";
    expect(() =>
      requireSafeE2EDatabase({
        E2E_ARTICLE_MASTER: "1",
        E2E_DATABASE_URL: url,
        E2E_ALLOW_REMOTE_DATABASE: "1",
      }),
    ).toThrow(/E2E_REMOTE_DATABASE_ACK/);
    expect(
      requireSafeE2EDatabase({
        E2E_ARTICLE_MASTER: "1",
        E2E_DATABASE_URL: url,
        E2E_ALLOW_REMOTE_DATABASE: "1",
        E2E_REMOTE_DATABASE_ACK: "I_UNDERSTAND_THIS_WILL_MUTATE_DATA",
      }),
    ).toBe(url);
  });

  it("pins every legacy Prisma alias to the checked database", () => {
    const env: Record<string, string | undefined> = {
      POSTGRES_URL_NON_POOLING: "postgresql://production.invalid/app",
    };
    const url = "postgresql://postgres:secret@localhost:5432/spc_test";

    pinE2EDatabaseAliases(url, env);

    expect(env.DATABASE_URL).toBe(url);
    expect(env.POSTGRES_URL_NON_POOLING).toBe(url);
    expect(env.POSTGRES_PRISMA_URL).toBe(url);
    expect(env.POSTGRES_URL).toBe(url);
  });
});
