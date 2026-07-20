import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const errors = [];
const warnings = [];

function value(name) {
  const item = process.env[name]?.trim();
  return item && !item.startsWith("GET_FROM_") ? item : null;
}

function enabled(name) {
  return ["1", "true", "yes", "on"].includes((value(name) ?? "").toLowerCase());
}

function requireNames(scope, names) {
  for (const name of names) if (!value(name)) errors.push(`${scope}: ${name} is missing or a placeholder`);
}

function publicHttps(name) {
  const item = value(name);
  if (!item) return errors.push(`${name} is missing`);
  try {
    const url = new URL(item);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      errors.push(`${name} must be a public HTTPS URL`);
    }
  } catch {
    errors.push(`${name} is not a valid URL`);
  }
}

requireNames("core", [
  "DATABASE_URL",
  "AUTH_SECRET",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "ORDER_ACCESS_TOKEN_SECRET",
  "EMAIL_UNSUBSCRIBE_SECRET",
]);
publicHttps("NEXT_PUBLIC_BASE_URL");

const authSecret = value("AUTH_SECRET");
if (authSecret && authSecret.length < 32) errors.push("AUTH_SECRET must contain at least 32 characters");
const database = value("DATABASE_URL");
if (database) {
  try {
    const url = new URL(database);
    if (url.port === "6543") errors.push("DATABASE_URL must use the non-pooling 5432 endpoint for this project");
  } catch {
    errors.push("DATABASE_URL is not a valid PostgreSQL URL");
  }
}

const emailProvider = (value("EMAIL_PROVIDER") ?? "none").toLowerCase();
if (emailProvider === "resend") {
  requireNames("Resend", ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_FROM", "EMAIL_REPLY_TO"]);
  if ((value("EMAIL_FROM") ?? "").includes("example.com")) errors.push("EMAIL_FROM still uses example.com");
} else if (emailProvider === "none") {
  warnings.push("Transactional email is disabled");
}

if (value("IPS_BASE_URL") || enabled("IPS_PRODUCTION_ACCEPTED")) {
  if (!enabled("IPS_PRODUCTION_ACCEPTED")) warnings.push("IPS is configured but remains behind the production acceptance gate");
  requireNames("IPS", ["IPS_PUBLIC_BASE_URL", "IPS_CALLBACK_URL"]);
  for (const name of ["IPS_PUBLIC_BASE_URL", "IPS_CALLBACK_URL", "IPS_SUCCESS_URL", "IPS_FAIL_URL", "IPS_CANCEL_URL"]) {
    if (value(name)) publicHttps(name);
  }
}
if (enabled("IPS_PRODUCTION_ACCEPTED")) {
  requireNames("IPS", ["IPS_BASE_URL", "IPS_USER_ID", "IPS_TID", "IPS_PUBLIC_BASE_URL", "IPS_CALLBACK_URL"]);
}
if (enabled("RAIACCEPT_PRODUCTION_ACCEPTED")) {
  requireNames("RaiAccept", ["RAIACCEPT_PUBLIC_BASE_URL", "RAIACCEPT_MERCHANT_ID", "RAIACCEPT_TERMINAL_ID", "RAIACCEPT_CALLBACK_SECRET"]);
}
if (enabled("MYGLS_ENABLED") || enabled("MYGLS_PRODUCTION_ACCEPTED")) {
  requireNames("MyGLS", [
    "MYGLS_USERNAME", "MYGLS_PASSWORD", "MYGLS_CLIENT_NUMBER",
    "MYGLS_PICKUP_NAME", "MYGLS_PICKUP_STREET", "MYGLS_PICKUP_CITY",
    "MYGLS_PICKUP_POSTAL_CODE", "MYGLS_PICKUP_CONTACT_NAME", "MYGLS_PICKUP_CONTACT_PHONE",
  ]);
  if (!enabled("MYGLS_PRODUCTION_ACCEPTED")) errors.push("MyGLS is enabled without MYGLS_PRODUCTION_ACCEPTED");
}
if (enabled("X_EXPRESS_ENABLED") || enabled("X_EXPRESS_PRODUCTION_ACCEPTED")) {
  requireNames("X Express", [
    "X_EXPRESS_BASE_URL", "X_EXPRESS_API_USER", "X_EXPRESS_API_KEY",
    "X_EXPRESS_CONTRACT_CODE", "X_EXPRESS_CHECK_ADDRESS_PATH", "X_EXPRESS_CREATE_ORDER_PATH",
    "X_EXPRESS_WEBHOOK_API_KEY",
  ]);
  if (!enabled("X_EXPRESS_PRODUCTION_ACCEPTED")) errors.push("X Express is enabled without X_EXPRESS_PRODUCTION_ACCEPTED");
}
if ((value("FISCAL_PROVIDER") ?? "").toLowerCase() === "badi") {
  requireNames("BADI", ["BADI_API_KEY", "BADI_API_SECRET", "FISCAL_TIN", "FISCAL_LOCATION_ID"]);
  if (!enabled("BADI_PRODUCTION_ACCEPTED")) errors.push("BADI is selected without BADI_PRODUCTION_ACCEPTED");
}
if (enabled("RABALUX_ENABLED")) {
  requireNames("Rabalux", [
    "RABALUX_CATALOG_USER",
    "RABALUX_CATALOG_PASS",
    "RABALUX_STOCK_USER",
    "RABALUX_STOCK_PASS",
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "EMAIL_FROM",
  ]);
  if (emailProvider === "none") {
    errors.push("Rabalux requires transactional email.");
  }
  const mediaWorkers = Number(value("RABALUX_MEDIA_WORKER_CONCURRENCY") ?? "2");
  if (!Number.isInteger(mediaWorkers) || mediaWorkers < 1 || mediaWorkers > 2) {
    errors.push("RABALUX_MEDIA_WORKER_CONCURRENCY must be 1 or 2");
  }
}

if (!value("NEXT_PUBLIC_MERCHANT_PHONE")) warnings.push("Public support phone is not configured");
if (!value("NEXT_PUBLIC_MERCHANT_RETURNS_ADDRESS")) warnings.push("Returns address is not configured");
const ga4Override = value("NEXT_PUBLIC_GA4_ID");
if (ga4Override && !ga4Override.startsWith("G-")) {
  warnings.push("NEXT_PUBLIC_GA4_ID override is invalid; the application default will be used");
}

for (const item of warnings) console.warn(`WARN: ${item}`);
for (const item of errors) console.error(`ERROR: ${item}`);
if (errors.length) {
  console.error(`Production environment check failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("Production environment check passed.");
