import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const envFile =
  process.env.CLIENT_FEEDBACK_E2E_ENV_FILE ||
  resolve(process.cwd(), ".env.local");
loadEnv({ path: envFile });
loadEnv();

const require = createRequire(import.meta.url);
const resolvedPrismaClientDir = dirname(
  require.resolve("@prisma/client/package.json"),
);
const resolvedPrismaCliDir = dirname(require.resolve("prisma/package.json"));
const localPrismaClientDir = resolve(
  process.cwd(),
  "node_modules/@prisma/client",
);
const localPrismaCliDir = resolve(process.cwd(), "node_modules/prisma");
const localGeneratedPrismaDir = resolve(
  process.cwd(),
  "node_modules/.prisma/client",
);
const needsIsolatedPrismaClient =
  resolvedPrismaClientDir !== localPrismaClientDir;

const raw = [
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_PRISMA_URL,
].find((value) => value?.trim());
if (!raw) {
  throw new Error("Client-feedback acceptance requires a database URL.");
}

const baseUrl = new URL(raw);
if (baseUrl.port === "6543") {
  throw new Error(
    "Client-feedback acceptance refuses the transaction pooler. Use the non-pooling 5432 URL.",
  );
}

const schema = `client_feedback_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", schema);
testUrl.searchParams.set("options", `-c search_path=${schema}`);
if (!["localhost", "127.0.0.1", "::1"].includes(testUrl.hostname)) {
  testUrl.searchParams.set("sslmode", "no-verify");
  testUrl.searchParams.delete("uselibpqcompat");
}
const databaseUrl = testUrl.toString();
const playwrightPort = process.env.CLIENT_FEEDBACK_E2E_PORT?.trim() || "3025";
if (!/^\d+$/.test(playwrightPort) || Number(playwrightPort) > 65_535) {
  throw new Error("CLIENT_FEEDBACK_E2E_PORT must be a valid TCP port.");
}
const localBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const e2eDistDir = ".next-client-feedback-e2e";
const defaultAcceptanceSpecs = [
  "tests/e2e/sales-order.spec.ts",
  "tests/e2e/pickup-batch.spec.ts",
  "tests/e2e/stocktake-dispatch.spec.ts",
  "tests/e2e/reclamation-analytics.spec.ts",
  "tests/e2e/module-8-warehouses.spec.ts",
];
const requestedAcceptanceSpecs = (process.env.CLIENT_FEEDBACK_E2E_SPECS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const acceptanceSpecs = requestedAcceptanceSpecs.length
  ? requestedAcceptanceSpecs
  : defaultAcceptanceSpecs;
const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  POSTGRES_URL_NON_POOLING: databaseUrl,
  POSTGRES_PRISMA_URL: databaseUrl,
  POSTGRES_URL: databaseUrl,
  E2E_DATABASE_URL: databaseUrl,
  E2E_ALLOW_REMOTE_DATABASE: "1",
  E2E_REMOTE_DATABASE_ACK: "I_UNDERSTAND_THIS_WILL_MUTATE_DATA",
  E2E_SALES_ORDERS: "1",
  E2E_PICKUP_BATCHES: "1",
  E2E_STOCKTAKE_DISPATCH: "1",
  E2E_RECLAMATION_ANALYTICS: "1",
  E2E_MODULE_8_WAREHOUSES: "1",
  EMAIL_PROVIDER: "none",
  FISCAL_PROVIDER: "none",
  AUTH_SECRET: "local-client-feedback-auth-secret-32-chars",
  ORDER_ACCESS_TOKEN_SECRET: "local-client-feedback-order-secret-32-chars",
  AUTH_URL: localBaseUrl,
  NEXTAUTH_URL: localBaseUrl,
  NEXT_PUBLIC_BASE_URL: localBaseUrl,
  AUTH_TRUST_HOST: "true",
  PLAYWRIGHT_PORT: playwrightPort,
  PLAYWRIGHT_WORKERS: "1",
  NEXT_DIST_DIR: e2eDistDir,
};

let exitCode = 1;
let isolatedPrismaPrepared = false;
try {
  if (needsIsolatedPrismaClient) {
    if (
      existsSync(localPrismaClientDir) ||
      existsSync(localPrismaCliDir) ||
      existsSync(localGeneratedPrismaDir)
    ) {
      throw new Error(
        "Client-feedback acceptance refuses to overwrite an existing local Prisma installation.",
      );
    }
    isolatedPrismaPrepared = true;
    mkdirSync(dirname(localPrismaClientDir), { recursive: true });
    cpSync(resolvedPrismaClientDir, localPrismaClientDir, { recursive: true });
    cpSync(resolvedPrismaCliDir, localPrismaCliDir, { recursive: true });
  }
  rmSync(resolve(process.cwd(), e2eDistDir), {
    recursive: true,
    force: true,
  });
  runPrisma(["generate", "--schema", "prisma/schema.prisma"], childEnv);
  runPrisma(
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    childEnv,
  );
  run(
    "npm",
    [
      "exec",
      "playwright",
      "--",
      "test",
      ...acceptanceSpecs,
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
    if (!/^client_feedback_e2e_[a-z0-9_]+$/.test(schema)) {
      throw new Error("Unsafe temporary schema name.");
    }
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    console.log(
      `client-feedback acceptance: removed temporary schema ${schema}`,
    );
  } finally {
    await client.end().catch(() => undefined);
    if (existsSync(resolve(process.cwd(), e2eDistDir))) {
      rmSync(resolve(process.cwd(), e2eDistDir), {
        recursive: true,
        force: true,
      });
    }
    if (isolatedPrismaPrepared) {
      rmSync(localPrismaClientDir, { recursive: true, force: true });
      rmSync(localPrismaCliDir, { recursive: true, force: true });
      rmSync(localGeneratedPrismaDir, { recursive: true, force: true });
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
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
}

function runPrisma(args, env) {
  if (needsIsolatedPrismaClient) {
    run(
      process.execPath,
      [resolve(localPrismaCliDir, "build/index.js"), ...args],
      env,
    );
    return;
  }
  run("npm", ["exec", "prisma", "--", ...args], env);
}
