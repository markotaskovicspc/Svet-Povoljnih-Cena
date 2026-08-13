import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const envFile =
  process.env.INBOUND_INVOICE_E2E_ENV_FILE ||
  resolve(process.cwd(), ".env.local");
loadEnv({ path: envFile });
loadEnv();

const raw = [
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_PRISMA_URL,
].find((value) => value?.trim());
if (!raw) throw new Error("Inbound-invoice acceptance requires a database URL.");

const baseUrl = new URL(raw);
if (baseUrl.port === "6543") {
  throw new Error(
    "Inbound-invoice acceptance refuses the transaction pooler. Use the non-pooling 5432 URL.",
  );
}
const schema = `inbound_invoice_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", schema);
const childEnv = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  E2E_DATABASE_URL: testUrl.toString(),
  E2E_ALLOW_REMOTE_DATABASE: "1",
  E2E_REMOTE_DATABASE_ACK: "I_UNDERSTAND_THIS_WILL_MUTATE_DATA",
  EMAIL_PROVIDER: "none",
  E2E_INBOUND_INVOICES: "1",
};

let exitCode = 1;
try {
  // Prisma's generated runtime shape is bundled by Next dev. A previous local
  // bundle can otherwise survive a schema change and exercise stale fields.
  rmSync(resolve(process.cwd(), ".next", "dev"), {
    recursive: true,
    force: true,
  });
  rmSync(resolve(process.cwd(), "node_modules", ".prisma", "client"), {
    recursive: true,
    force: true,
  });
  run(
    "prisma",
    ["generate", "--schema", "prisma/schema.prisma"],
    childEnv,
  );
  run(
    "prisma",
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    childEnv,
  );
  run("npm", ["run", "test:e2e:inbound-invoices"], childEnv);
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
    if (!/^inbound_invoice_e2e_[a-z0-9_]+$/.test(schema)) {
      throw new Error("Unsafe temporary schema name.");
    }
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    console.log(`inbound-invoice acceptance: removed temporary schema ${schema}`);
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
