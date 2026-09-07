import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const envFile =
  process.env.MYGLS_E2E_ENV_FILE || resolve(process.cwd(), ".env.local");
loadEnv({ path: envFile });
loadEnv();

const require = createRequire(import.meta.url);
const resolvedPrismaClientDir = dirname(
  require.resolve("@prisma/client/package.json"),
);
const resolvedPrismaCliDir = dirname(require.resolve("prisma/package.json"));
const localPrismaClientDir = resolve(process.cwd(), "node_modules/@prisma/client");
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
  throw new Error("MyGLS acceptance requires a database URL.");
}

const baseUrl = new URL(raw);
if (baseUrl.port === "6543") {
  throw new Error(
    "MyGLS acceptance refuses the transaction pooler. Use the non-pooling 5432 URL.",
  );
}

const schema = `mygls_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", schema);
testUrl.searchParams.set("options", `-c search_path=${schema}`);
if (!isLocalHost(testUrl.hostname)) {
  testUrl.searchParams.set("sslmode", "no-verify");
  testUrl.searchParams.delete("uselibpqcompat");
}
const databaseUrl = testUrl.toString();
const playwrightPort = validPort("MYGLS_E2E_PORT", "3026");
const storagePort = validPort("MYGLS_E2E_STORAGE_PORT", "54322");
const providerPort = validPort("MYGLS_E2E_PROVIDER_PORT", "54323");
const localBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const storageBaseUrl = `http://127.0.0.1:${storagePort}`;
const providerBaseUrl = `http://127.0.0.1:${providerPort}`;
const e2eDistDir = ".next-mygls-e2e";
const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  POSTGRES_URL_NON_POOLING: databaseUrl,
  POSTGRES_PRISMA_URL: databaseUrl,
  POSTGRES_URL: databaseUrl,
  E2E_DATABASE_URL: databaseUrl,
  E2E_ALLOW_REMOTE_DATABASE: "1",
  E2E_REMOTE_DATABASE_ACK: "I_UNDERSTAND_THIS_WILL_MUTATE_DATA",
  DATABASE_POOL_MAX: "5",
  DATABASE_TRANSACTION_MAX_WAIT_MS: "30000",
  DATABASE_TRANSACTION_TIMEOUT_MS: "60000",
  E2E_MYGLS_FLOW: "1",
  EMAIL_PROVIDER: "none",
  FISCAL_PROVIDER: "none",
  FISCAL_TIN: "123456789",
  AUTH_SECRET: "local-mygls-acceptance-auth-secret-32-chars",
  ORDER_ACCESS_TOKEN_SECRET: "local-mygls-acceptance-order-secret-32-chars",
  AUTH_URL: localBaseUrl,
  NEXTAUTH_URL: localBaseUrl,
  NEXT_PUBLIC_BASE_URL: localBaseUrl,
  AUTH_TRUST_HOST: "true",
  PLAYWRIGHT_PORT: playwrightPort,
  PLAYWRIGHT_WORKERS: "1",
  NEXT_DIST_DIR: e2eDistDir,
  NEXT_PUBLIC_SUPABASE_URL: storageBaseUrl,
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.isolated",
  STORAGE_MOCK_HOST: "127.0.0.1",
  STORAGE_MOCK_PORT: storagePort,
  MYGLS_MOCK_HOST: "127.0.0.1",
  MYGLS_MOCK_PORT: providerPort,
  COURIER_SMALL_PROVIDER: "MYGLS",
  MYGLS_ENABLED: "true",
  MYGLS_AUTO_CREATE: "false",
  MYGLS_ENV: "test",
  MYGLS_BASE_URL: providerBaseUrl,
  MYGLS_USERNAME: "isolated-user",
  MYGLS_PASSWORD: "isolated-password",
  MYGLS_CLIENT_NUMBER: "123456",
  MYGLS_SENDER_IDENTITY_CARD_NUMBER: "123456789",
  MYGLS_SENDER_IDENTITY_TYPE: "PIB",
  MYGLS_WEBSHOP_ENGINE: "SPC isolated acceptance",
  MYGLS_DEFAULT_CONTENT: "Izolovani GLS test",
  MYGLS_TYPE_OF_PRINTER: "A4_2x2",
  MYGLS_LABEL_BUCKET: "shipment-labels",
  MYGLS_COD_CARD_ENABLED: "true",
  MYGLS_CONTACT_SERVICE_ENABLED: "true",
  MYGLS_FLEX_DELIVERY_SERVICE_ENABLED: "true",
  MYGLS_PRODUCTION_ACCEPTED: "false",
  MYGLS_PICKUP_NAME: "Svet povoljnih cena QA",
  MYGLS_PICKUP_STREET: "Testna ulica",
  MYGLS_PICKUP_HOUSE_NUMBER: "1",
  MYGLS_PICKUP_HOUSE_NUMBER_INFO: "lokal QA",
  MYGLS_PICKUP_CITY: "Beograd",
  MYGLS_PICKUP_POSTAL_CODE: "11000",
  MYGLS_PICKUP_COUNTRY: "RS",
  MYGLS_PICKUP_CONTACT_NAME: "QA Operater",
  MYGLS_PICKUP_CONTACT_PHONE: "+38160111222",
  MYGLS_PICKUP_CONTACT_EMAIL: "qa@example.invalid",
  RABALUX_ENABLED: "true",
  RABALUX_CATALOG_USER: "isolated-user",
  RABALUX_CATALOG_PASS: "isolated-password",
  RABALUX_STOCK_USER: "isolated-user",
  RABALUX_STOCK_PASS: "isolated-password",
  RABALUX_PICKUP_NAME: "Rabalux QA magacin",
  RABALUX_PICKUP_STREET: "Industrijska",
  RABALUX_PICKUP_HOUSE_NUMBER: "12",
  RABALUX_PICKUP_HOUSE_NUMBER_INFO: "QA ulaz",
  RABALUX_PICKUP_CITY: "Beograd",
  RABALUX_PICKUP_POSTAL_CODE: "11000",
  RABALUX_PICKUP_COUNTRY: "RS",
  RABALUX_PICKUP_CONTACT_NAME: "Rabalux QA",
  RABALUX_PICKUP_CONTACT_PHONE: "+38160111223",
  RABALUX_PICKUP_CONTACT_EMAIL: "rabalux-qa@example.invalid",
  RABALUX_X_EXPRESS_TOWN_ID: "9902026",
  RABALUX_X_EXPRESS_LATITUDE: "44.8125",
  RABALUX_X_EXPRESS_LONGITUDE: "20.4612",
  X_EXPRESS_ENABLED: "true",
  X_EXPRESS_ENV: "test",
  X_EXPRESS_BASE_URL: providerBaseUrl,
  X_EXPRESS_API_USER: "isolated-user",
  X_EXPRESS_API_KEY: "isolated-key",
  X_EXPRESS_CONTRACT_CODE: "U000328",
  X_EXPRESS_CODE_PREFIX: "QAX",
  X_EXPRESS_CODE_RANGE_START: "850300001",
  X_EXPRESS_CODE_RANGE_END: "850599999",
  X_EXPRESS_CHECK_ADDRESS_PATH: "/api/order/check-address",
  X_EXPRESS_CREATE_ORDER_PATH: "/api/order/add",
  BACKGROUND_JOBS_CRON_SECRET: "isolated-background-jobs-secret",
  ENFORCE_WEB_AUTO_AVAILABILITY: "false",
};
// A parent shell may point Playwright at a real site. This suite must always
// start its own local Next server against the temporary schema.
delete childEnv.PLAYWRIGHT_BASE_URL;

let exitCode = 1;
let isolatedPrismaPrepared = false;
const servers = [];
try {
  if (needsIsolatedPrismaClient) {
    if (
      existsSync(localPrismaClientDir) ||
      existsSync(localPrismaCliDir) ||
      existsSync(localGeneratedPrismaDir)
    ) {
      throw new Error(
        "MyGLS acceptance refuses to overwrite an existing local Prisma installation.",
      );
    }
    isolatedPrismaPrepared = true;
    mkdirSync(dirname(localPrismaClientDir), { recursive: true });
    cpSync(resolvedPrismaClientDir, localPrismaClientDir, { recursive: true });
    cpSync(resolvedPrismaCliDir, localPrismaCliDir, { recursive: true });
  }

  if (process.env.MYGLS_E2E_RUNNER !== "vitest") {
    rmSync(resolve(process.cwd(), e2eDistDir), { recursive: true, force: true });
  }
  servers.push(
    startServer("Supabase storage mock", "tests/support/supabase-storage-mock.mjs"),
    startServer("MyGLS mock", "tests/support/mygls-mock.mjs"),
  );
  await Promise.all([
    waitForHealth(`${storageBaseUrl}/health`, "Supabase storage mock"),
    waitForHealth(`${providerBaseUrl}/health`, "MyGLS mock"),
  ]);

  runPrisma(["generate", "--schema", "prisma/schema.prisma"], childEnv);
  if (process.env.MYGLS_E2E_SCHEMA_MODE === "sql") {
    // Generate offline, then initialize only the fresh guarded test schema.
    // This avoids slow schema-engine TLS sessions through the hosted pooler.
    const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "spc-test-schema-"));
    const sqlPath = resolve(temporaryDirectory, "schema.sql");
    const setupClient = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
    try {
      runPrisma(["migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script", "--output", sqlPath], childEnv);
      if (!/^mygls_e2e_[a-z0-9_]+$/.test(schema)) throw new Error("Unsafe temporary schema name.");
      const sql = readFileSync(sqlPath, "utf8")
        .replace('CREATE SCHEMA IF NOT EXISTS "public";', "")
        .replaceAll('"public".', `"${schema}".`);
      await setupClient.connect();
      await setupClient.query("BEGIN");
      await setupClient.query(`CREATE SCHEMA "${schema}"`);
      await setupClient.query(`SET LOCAL search_path TO "${schema}"`);
      await setupClient.query(sql);
      await setupClient.query("COMMIT");
    } finally {
      await setupClient.end().catch(() => undefined);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  } else {
    runPrisma(
      process.env.MYGLS_E2E_SCHEMA_MODE === "push"
        ? ["db", "push", "--schema", "prisma/schema.prisma"]
        : ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
      childEnv,
    );
  }
  const specs = process.env.MYGLS_E2E_SPECS || "tests/e2e/mygls-flow.spec.ts";
  if (process.env.MYGLS_E2E_RUNNER === "vitest") {
    const vitestArgs = [
      "exec",
      "vitest",
      "--",
      "run",
      "--config",
      "vitest.integration.config.ts",
      specs,
    ];
    if (process.env.MYGLS_E2E_TEST_NAME_PATTERN) {
      vitestArgs.push("--testNamePattern", process.env.MYGLS_E2E_TEST_NAME_PATTERN);
    }
    run(
      "npm",
      vitestArgs,
      childEnv,
    );
  } else {
    run(
      "npm",
      [
        "exec",
        "playwright",
        "--",
        "test",
        specs,
        "--project=desktop",
        "--workers=1",
      ],
      childEnv,
    );
  }
  exitCode = 0;
} finally {
  for (const server of servers) {
    if (!server.killed) server.kill("SIGTERM");
  }

  const cleanupUrl = new URL(baseUrl);
  cleanupUrl.searchParams.delete("schema");
  cleanupUrl.searchParams.delete("options");
  if (!isLocalHost(cleanupUrl.hostname)) {
    cleanupUrl.searchParams.set("sslmode", "no-verify");
    cleanupUrl.searchParams.delete("uselibpqcompat");
  }
  const client = new pg.Client({
    connectionString: cleanupUrl.toString(),
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    if (!/^mygls_e2e_[a-z0-9_]+$/.test(schema)) {
      throw new Error("Unsafe temporary schema name.");
    }
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    console.log(`MyGLS acceptance: removed temporary schema ${schema}`);
  } finally {
    await client.end().catch(() => undefined);
    if (process.env.MYGLS_E2E_RUNNER !== "vitest") {
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

function startServer(label, script) {
  const child = spawn(process.execPath, [resolve(process.cwd(), script)], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`${label}: ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`${label}: ${chunk}`));
  return child;
}

async function waitForHealth(url, label) {
  let lastError = "no response";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${label} did not become ready: ${lastError}`);
}

function validPort(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^\d+$/.test(value) || Number(value) > 65_535 || Number(value) < 1) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return value;
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

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
