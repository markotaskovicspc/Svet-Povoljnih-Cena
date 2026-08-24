import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const envFile = process.env.NEWSLETTER_E2E_ENV_FILE || resolve(process.cwd(), ".env.local");
const schemaFile = resolve(process.cwd(), "prisma/schema.prisma");
loadEnv({ path: envFile });
loadEnv();

const raw = [
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_PRISMA_URL,
].find((value) => value?.trim());
if (!raw) throw new Error("Newsletter acceptance requires a database URL.");

const baseUrl = new URL(raw);
if (baseUrl.port === "6543") {
  throw new Error("Newsletter acceptance refuses the transaction pooler. Use the non-pooling 5432 URL.");
}
const requestedSchema = process.env.NEWSLETTER_E2E_SCHEMA?.trim();
const schema = requestedSchema || `newsletter_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
if (!/^newsletter_e2e_[a-z0-9_]+$/.test(schema)) {
  throw new Error("Unsafe newsletter acceptance schema name.");
}
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", schema);
const playwrightPort = process.env.PLAYWRIGHT_PORT?.trim() || "3018";
const testBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const project = process.env.NEWSLETTER_E2E_PROJECT?.trim() || "desktop";
if (!/^[a-z0-9-]+$/.test(project)) {
  throw new Error("Unsafe Playwright project name.");
}
const childEnv = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  E2E_DATABASE_URL: testUrl.toString(),
  E2E_ALLOW_REMOTE_DATABASE: "1",
  E2E_REMOTE_DATABASE_ACK: "I_UNDERSTAND_THIS_WILL_MUTATE_DATA",
  PLAYWRIGHT_PORT: playwrightPort,
  AUTH_URL: testBaseUrl,
  NEXTAUTH_URL: testBaseUrl,
  NEXT_PUBLIC_BASE_URL: testBaseUrl,
  AUTH_TRUST_HOST: "true",
  EMAIL_PROVIDER: "none",
  RESEND_API_KEY: "",
  RESEND_TOPIC_PROMOTIONS_ID: "",
  AUTH_SECRET: "newsletter-e2e-auth-secret-32-characters",
  NEXTAUTH_SECRET: "newsletter-e2e-auth-secret-32-characters",
  EMAIL_UNSUBSCRIBE_SECRET: "newsletter-e2e-unsubscribe-secret-32-characters",
  BACKGROUND_JOBS_CRON_SECRET: "newsletter-e2e-cron-secret-32-characters",
  NEWSLETTER_TWO_PERSON_APPROVAL_THRESHOLD: "2",
  E2E_NEWSLETTER: "1",
};

let exitCode = 1;
try {
  if (process.env.NEWSLETTER_E2E_SKIP_SETUP !== "1") {
    run("prisma", ["generate", "--schema", schemaFile], childEnv);
    if (process.env.NEWSLETTER_E2E_SCHEMA_MODE === "push") {
      run("prisma", ["db", "push", "--schema", schemaFile], childEnv);
    } else {
      run("prisma", ["migrate", "deploy", "--schema", schemaFile], childEnv);
    }
  }
  run("npx", [
    "playwright",
    "test",
    "tests/e2e/newsletter-admin.spec.ts",
    `--project=${project}`,
    "--workers=1",
  ], childEnv);
  exitCode = 0;
} finally {
  if (process.env.NEWSLETTER_E2E_KEEP_SCHEMA === "1") {
    console.log(`newsletter acceptance: kept temporary schema ${schema}`);
    process.exitCode = exitCode;
  } else {
  const cleanupUrl = new URL(baseUrl);
  cleanupUrl.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(cleanupUrl.hostname)) {
    cleanupUrl.searchParams.set("sslmode", "no-verify");
    cleanupUrl.searchParams.delete("uselibpqcompat");
  }
  const client = new pg.Client({ connectionString: cleanupUrl.toString(), connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    console.log(`newsletter acceptance: removed temporary schema ${schema}`);
  } finally {
    await client.end().catch(() => undefined);
  }
  }
}

process.exit(exitCode);

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}
