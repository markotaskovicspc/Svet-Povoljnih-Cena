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

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
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
