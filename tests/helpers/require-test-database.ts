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
const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const explicitlyAllowedRemote =
  Boolean(explicitTestUrl) &&
  process.env.RABALUX_ALLOW_REMOTE_TEST_DB === "true" &&
  connectionString === explicitTestUrl;

if (!/test/i.test(databaseName) || (!localHost && !explicitlyAllowedRemote)) {
  throw new Error(
    "Refusing destructive Rabalux integration tests: use a database whose name contains 'test'. Remote databases additionally require RABALUX_TEST_DATABASE_URL and RABALUX_ALLOW_REMOTE_TEST_DB=true.",
  );
}
