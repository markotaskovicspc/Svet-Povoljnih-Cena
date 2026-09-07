import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const explicitTestUrl = process.env.RABALUX_TEST_DATABASE_URL?.trim();
if (explicitTestUrl) process.env.DATABASE_URL = explicitTestUrl;

const connectionString = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_URL_NON_POOLING,
].find((value) => value?.trim());

if (!connectionString) {
  throw new Error(
    "Rabalux integration tests require an isolated test database URL.",
  );
}

let url: URL;
try {
  url = new URL(connectionString);
} catch {
  throw new Error("Rabalux integration test database URL is invalid.");
}

const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
const schemaName = url.searchParams.get("schema")?.trim() ?? "";
const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const explicitlyAllowedRemote =
  Boolean(explicitTestUrl) &&
  process.env.RABALUX_ALLOW_REMOTE_TEST_DB === "true" &&
  connectionString === explicitTestUrl;
const isolatedAcceptanceSchema =
  /^mygls_e2e_[a-z0-9_]+$/.test(schemaName) &&
  process.env.E2E_ALLOW_REMOTE_DATABASE === "1" &&
  process.env.E2E_REMOTE_DATABASE_ACK ===
    "I_UNDERSTAND_THIS_WILL_MUTATE_DATA";

if (
  (!/test/i.test(databaseName) && !isolatedAcceptanceSchema) ||
  (!localHost && !explicitlyAllowedRemote && !isolatedAcceptanceSchema)
) {
  throw new Error(
    "Refusing destructive integration tests: use a database whose name contains 'test', or the guarded isolated acceptance schema. Remote test databases additionally require an explicit acknowledgement.",
  );
}
