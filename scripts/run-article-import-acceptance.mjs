import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const envFile =
  process.env.ARTICLE_IMPORT_E2E_ENV_FILE ||
  resolve(process.cwd(), ".env.local");
loadEnv({ path: envFile });
loadEnv();

const raw = [
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_PRISMA_URL,
].find((value) => value?.trim());
if (!raw) throw new Error("Article-import acceptance requires a database URL.");

const baseUrl = new URL(raw);
if (baseUrl.port === "6543") {
  throw new Error(
    "Article-import acceptance refuses the transaction pooler. Use the non-pooling 5432 URL.",
  );
}

const schema = `article_import_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
const e2eDistDir = ".next-erp-e2e";
const playwrightPort = "3023";
const localBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", schema);
const databaseUrl = testUrl.toString();
const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  POSTGRES_URL_NON_POOLING: databaseUrl,
  POSTGRES_PRISMA_URL: databaseUrl,
  POSTGRES_URL: databaseUrl,
  E2E_DATABASE_URL: databaseUrl,
  E2E_ALLOW_REMOTE_DATABASE: "1",
  E2E_REMOTE_DATABASE_ACK: "I_UNDERSTAND_THIS_WILL_MUTATE_DATA",
  E2E_ARTICLE_IMPORT: "1",
  EMAIL_PROVIDER: "none",
  AUTH_URL: localBaseUrl,
  NEXTAUTH_URL: localBaseUrl,
  NEXT_PUBLIC_BASE_URL: localBaseUrl,
  AUTH_TRUST_HOST: "true",
  PLAYWRIGHT_PORT: playwrightPort,
  NEXT_DIST_DIR: e2eDistDir,
};

let exitCode = 1;
try {
  rmSync(resolve(process.cwd(), e2eDistDir), {
    recursive: true,
    force: true,
  });
  run(
    "prisma",
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    childEnv,
  );
  run(
    "playwright",
    [
      "test",
      "tests/e2e/article-import-workflow.spec.ts",
      "--project=desktop",
      "--workers=1",
    ],
    childEnv,
  );
  exitCode = 0;
} finally {
  const cleanupUrl = new URL(baseUrl);
  cleanupUrl.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(cleanupUrl.hostname)) {
    cleanupUrl.searchParams.set("sslmode", "no-verify");
    cleanupUrl.searchParams.delete("uselibpqcompat");
  }
  const client = new pg.Client({
    connectionString: cleanupUrl.toString(),
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    if (!/^article_import_e2e_[a-z0-9_]+$/.test(schema)) {
      throw new Error("Unsafe temporary schema name.");
    }
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    console.log(`article-import acceptance: removed temporary schema ${schema}`);
  } finally {
    await client.end().catch(() => undefined);
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
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
}
