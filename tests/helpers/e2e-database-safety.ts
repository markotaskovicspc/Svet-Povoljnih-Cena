const READ_ONLY_E2E_FLAGS = new Set([
  "E2E_CROSS_SELL",
  "E2E_LIVE_CATALOG",
]);

const E2E_CONTROL_FLAGS = new Set([
  "E2E_ALLOW_REMOTE_DATABASE",
  "E2E_ALLOW_REMOTE_PURCHASE_PRICE_DB",
  "E2E_REMOTE_DATABASE_ACK",
]);

const REMOTE_DATABASE_ACK = "I_UNDERSTAND_THIS_WILL_MUTATE_DATA";
type Environment = Record<string, string | undefined>;

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function activeMutationFlags(env: Environment) {
  return Object.entries(env)
    .filter(([key, value]) => {
      if (!key.startsWith("E2E_") || !isEnabled(value)) return false;
      return !READ_ONLY_E2E_FLAGS.has(key) && !E2E_CONTROL_FLAGS.has(key);
    })
    .map(([key]) => key)
    .sort();
}

/**
 * Fail closed before Playwright starts any suite that can mutate business data.
 * The explicit URL is then copied to every database alias so dotenv fallbacks in
 * the app or an older test helper cannot silently switch the suite to another DB.
 */
export function requireSafeE2EDatabase(
  env: Environment = process.env,
): string | null {
  const mutationFlags = activeMutationFlags(env);
  const raw = env.E2E_DATABASE_URL?.trim();
  if (mutationFlags.length === 0 && !raw) return null;
  if (!raw) {
    throw new Error(
      `${mutationFlags.join(", ")} can write data. Set an explicit E2E_DATABASE_URL for an isolated QA/test database.`,
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E2E_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error("E2E_DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const schemaName = url.searchParams.get("schema")?.trim() ?? "";
  const hasIsolatedDatabaseName = /(^|[_-])(qa|test)([_-]|$)/i.test(
    databaseName,
  );
  const hasIsolatedSchemaName = /(^|[_-])(qa|test|e2e)([_-]|$)/i.test(
    schemaName,
  );
  if (!hasIsolatedDatabaseName && !hasIsolatedSchemaName) {
    throw new Error(
      `Refusing E2E mutations against database “${databaseName || "(missing)"}”: its name must contain a separate qa or test segment, or its schema must contain a separate qa, test, or e2e segment.`,
    );
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!isLocal) {
    if (!isEnabled(env.E2E_ALLOW_REMOTE_DATABASE)) {
      throw new Error(
        "Remote E2E mutations are disabled. Use a localhost QA/test database, or explicitly set E2E_ALLOW_REMOTE_DATABASE=1.",
      );
    }
    if (env.E2E_REMOTE_DATABASE_ACK !== REMOTE_DATABASE_ACK) {
      throw new Error(
        `Remote E2E mutations also require E2E_REMOTE_DATABASE_ACK=${REMOTE_DATABASE_ACK}.`,
      );
    }
  }

  return raw;
}

export function pinE2EDatabaseAliases(
  databaseUrl: string,
  env: Environment = process.env,
) {
  env.DATABASE_URL = databaseUrl;
  env.POSTGRES_URL_NON_POOLING = databaseUrl;
  env.POSTGRES_PRISMA_URL = databaseUrl;
  env.POSTGRES_URL = databaseUrl;
}
