import { afterEach, describe, expect, it } from "vitest";
import {
  databaseIdentifier,
  getDatabaseConnectionString,
  getDatabaseIdleTimeoutMillis,
  getDatabasePoolMax,
  getDatabaseSchemaName,
} from "@/lib/db";

const ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_IDLE_TIMEOUT_MS",
  "DATABASE_POOL_MAX",
  "VERCEL",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("database runtime configuration", () => {
  it("prefers the 5432 non-pooling fallback when DATABASE_URL is absent", () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_PRISMA_URL = "postgresql://db.example:6543/postgres";
    process.env.POSTGRES_URL = "postgresql://db.example:6543/postgres";
    process.env.POSTGRES_URL_NON_POOLING =
      "postgresql://db.example:5432/postgres";

    expect(getDatabaseConnectionString()).toBe(
      "postgresql://db.example:5432/postgres",
    );
  });

  it("uses a wider local pool while keeping Vercel conservative", () => {
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.VERCEL;
    expect(getDatabasePoolMax()).toBe(5);

    process.env.VERCEL = "1";
    expect(getDatabasePoolMax()).toBe(1);

    process.env.DATABASE_POOL_MAX = "4";
    expect(getDatabasePoolMax()).toBe(4);
  });

  it("closes idle Vercel sessions quickly while keeping local reuse", () => {
    delete process.env.DATABASE_IDLE_TIMEOUT_MS;
    delete process.env.VERCEL;
    expect(getDatabaseIdleTimeoutMillis()).toBe(10_000);

    process.env.VERCEL = "1";
    expect(getDatabaseIdleTimeoutMillis()).toBe(1_000);

    process.env.DATABASE_IDLE_TIMEOUT_MS = "2500";
    expect(getDatabaseIdleTimeoutMillis()).toBe(2_500);
  });

  it("qualifies raw SQL identifiers with the configured isolated schema", () => {
    process.env.DATABASE_URL =
      "postgresql://db.example:5432/postgres?schema=newsletter_e2e_123";

    expect(getDatabaseSchemaName()).toBe("newsletter_e2e_123");
    expect((databaseIdentifier("MarketingContact") as unknown as { sql: string }).sql)
      .toBe('"newsletter_e2e_123"."MarketingContact"');
    expect(() => databaseIdentifier('MarketingContact"; DROP SCHEMA public'))
      .toThrow("Unsafe database identifier");
  });
});
