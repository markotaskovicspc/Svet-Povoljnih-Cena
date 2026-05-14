import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton — avoids exhausting connections during HMR in dev.
 * Prisma 7 requires a driver adapter; we use `@prisma/adapter-pg` for Postgres.
 * When using Supabase, `DATABASE_URL` must be the Supabase Postgres connection
 * string, not the Supabase project API URL.
 * Import as: `import { db } from "@/lib/db"`.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function withSslNoVerify(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=no-verify`;
  }
}

function createClient(): PrismaClient {
  const connectionString = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
  if (!connectionString) {
    throw new Error(
      "Database connection string is not set. Expected DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL, or POSTGRES_URL_NON_POOLING.",
    );
  }
  const adapter = new PrismaPg(withSslNoVerify(connectionString));
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

/**
 * Lazy proxy: defer Prisma client construction (and DATABASE_URL validation)
 * until the first property access. This prevents build-time crashes when
 * Next.js collects page data for routes that import db transitively but
 * never execute it (e.g. force-dynamic API routes during `next build`).
 */
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
