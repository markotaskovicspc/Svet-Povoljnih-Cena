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

function withDatabaseSsl(connectionString: string) {
  const configuredSslMode = process.env.DATABASE_SSLMODE?.trim();
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    const sslMode =
      configuredSslMode || url.searchParams.get("sslmode")?.trim() || "require";
    url.searchParams.set("sslmode", sslMode);
    if (configuredSslMode) {
      url.searchParams.delete("uselibpqcompat");
    }
    if (usesLibpqCompatibleSsl(sslMode)) {
      url.searchParams.set("uselibpqcompat", "true");
    }
    return url.toString();
  } catch {
    const sslMode = configuredSslMode || "require";
    const separator = connectionString.includes("?") ? "&" : "?";
    const compat = usesLibpqCompatibleSsl(sslMode)
      ? "&uselibpqcompat=true"
      : "";
    return `${connectionString}${separator}sslmode=${sslMode}${compat}`;
  }
}

function databaseAdapterOptions(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const schema = url.searchParams.get("schema")?.trim() || undefined;
    // `schema` is a Prisma URL option, not a node-postgres connection option.
    // The driver adapter needs it explicitly so isolated schemas and non-public
    // deployments generate qualified queries correctly.
    url.searchParams.delete("schema");
    return { connectionString: withDatabaseSsl(url.toString()), schema };
  } catch {
    return { connectionString: withDatabaseSsl(connectionString), schema: undefined };
  }
}

function usesLibpqCompatibleSsl(sslMode: string) {
  return ["prefer", "require", "verify-ca"].includes(sslMode.toLowerCase());
}

function databasePoolMax() {
  const configured = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isFinite(configured) ? Math.max(1, Math.min(configured, 10)) : 1;
}

function databaseConnectionTimeoutMillis() {
  const configured = Number.parseInt(
    process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "",
    10,
  );
  if (configured === 0) return 0;
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(configured, 60_000))
    : 15_000;
}

function databaseTransactionMaxWaitMillis() {
  const configured = Number.parseInt(
    process.env.DATABASE_TRANSACTION_MAX_WAIT_MS ?? "",
    10,
  );
  return Number.isFinite(configured)
    ? Math.max(2_000, Math.min(configured, 30_000))
    : 5_000;
}

function databaseTransactionTimeoutMillis() {
  const configured = Number.parseInt(
    process.env.DATABASE_TRANSACTION_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(configured)
    ? Math.max(5_000, Math.min(configured, 60_000))
    : 15_000;
}

export function getDatabaseConnectionString() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
}

export function hasDatabaseConnection() {
  return Boolean(getDatabaseConnectionString());
}

function createClient(): PrismaClient {
  const connectionString = getDatabaseConnectionString();
  if (!connectionString) {
    throw new Error(
      "Database connection string is not set. Expected DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL, or POSTGRES_URL_NON_POOLING.",
    );
  }
  const adapterOptions = databaseAdapterOptions(connectionString);
  if (process.env.E2E_DATABASE_DIAGNOSTICS === "1") {
    try {
      const target = new URL(connectionString);
      console.info(
        "[db-target]",
        JSON.stringify({
          host: target.hostname,
          port: target.port || "5432",
          database: target.pathname.replace(/^\//, ""),
        }),
      );
    } catch {
      console.info("[db-target]", JSON.stringify({ invalidUrl: true }));
    }
  }
  const adapter = new PrismaPg(
    {
      connectionString: adapterOptions.connectionString,
      // Next.js build workers and serverless instances each create a process-local
      // pool. Keep the default at one so Supabase's session-mode limit is not
      // multiplied by the worker count; deployments may raise it explicitly.
      max: databasePoolMax(),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    },
    { schema: adapterOptions.schema },
  );
  return new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: databaseTransactionMaxWaitMillis(),
      timeout: databaseTransactionTimeoutMillis(),
    },
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
