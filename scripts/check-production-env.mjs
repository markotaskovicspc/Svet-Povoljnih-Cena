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

function validBoolean(name) {
  const item = value(name);
  if (item && !["0", "1", "true", "false", "yes", "no", "on", "off"].includes(item.toLowerCase())) {
    errors.push(`${name} must be a boolean value`);
  }
}

function requireNames(scope, names) {
  for (const name of names) if (!value(name)) errors.push(`${scope}: ${name} is missing or a placeholder`);
}

function requireOneOf(scope, names) {
  if (!names.some((name) => value(name))) {
    errors.push(`${scope}: one of ${names.join(", ")} is required`);
  }
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

if (enabled("ENFORCE_WEB_AUTO_AVAILABILITY")) {
  errors.push(
    "ENFORCE_WEB_AUTO_AVAILABILITY must remain false until DC stock is imported and audited",
  );
}

const emailProvider = (value("EMAIL_PROVIDER") ?? "none").toLowerCase();
if (emailProvider === "ses") {
  requireNames("Amazon SES", [
    "EMAIL_FROM",
    "EMAIL_MARKETING_FROM",
    "EMAIL_REPLY_TO",
  ]);
  if (!value("AWS_ROLE_ARN") && !(value("AWS_ACCESS_KEY_ID") && value("AWS_SECRET_ACCESS_KEY"))) {
    errors.push("Amazon SES: AWS_ROLE_ARN or an AWS access key pair is required");
  }
  requireOneOf("Amazon SES", ["SES_REGION", "AWS_REGION"]);
  if ((value("SES_REGION") ?? value("AWS_REGION")) !== "eu-central-1") {
    errors.push("Amazon SES region must be eu-central-1 for this project");
  }
  if ((value("EMAIL_FROM") ?? "").includes("example.com")) errors.push("EMAIL_FROM still uses example.com");
  if ((value("EMAIL_MARKETING_FROM") ?? "").includes("example.com")) errors.push("EMAIL_MARKETING_FROM still uses example.com");
} else if (emailProvider === "resend") {
  requireNames("Resend", [
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "RESEND_TOPIC_PROMOTIONS_ID",
    "EMAIL_FROM",
    "EMAIL_MARKETING_FROM",
    "EMAIL_REPLY_TO",
  ]);
  if ((value("EMAIL_FROM") ?? "").includes("example.com")) errors.push("EMAIL_FROM still uses example.com");
  if ((value("EMAIL_MARKETING_FROM") ?? "").includes("example.com")) errors.push("EMAIL_MARKETING_FROM still uses example.com");
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
  const myGlsEnv = (value("MYGLS_ENV") ?? "test").toLowerCase();
  if (!["test", "production"].includes(myGlsEnv)) {
    errors.push("MYGLS_ENV must be test or production");
  }
  requireNames("MyGLS", [
    "MYGLS_USERNAME", "MYGLS_PASSWORD", "MYGLS_CLIENT_NUMBER",
    "MYGLS_SENDER_IDENTITY_CARD_NUMBER", "MYGLS_SENDER_IDENTITY_TYPE",
    "MYGLS_PICKUP_NAME", "MYGLS_PICKUP_STREET", "MYGLS_PICKUP_HOUSE_NUMBER", "MYGLS_PICKUP_CITY",
    "MYGLS_PICKUP_POSTAL_CODE", "MYGLS_PICKUP_CONTACT_NAME", "MYGLS_PICKUP_CONTACT_PHONE",
  ]);
  for (const name of [
    "MYGLS_AUTO_CREATE",
    "MYGLS_COD_CARD_ENABLED",
    "MYGLS_CONTACT_SERVICE_ENABLED",
    "MYGLS_FLEX_DELIVERY_SERVICE_ENABLED",
  ]) validBoolean(name);
  const identityType = (value("MYGLS_SENDER_IDENTITY_TYPE") ?? "").toUpperCase();
  if (identityType && !["PIB", "ID_CARD"].includes(identityType)) {
    errors.push("MYGLS_SENDER_IDENTITY_TYPE must be PIB or ID_CARD");
  }
  const senderIdentity = value("MYGLS_SENDER_IDENTITY_CARD_NUMBER");
  if (identityType === "PIB" && senderIdentity && !/^\d{9}$/.test(senderIdentity)) {
    errors.push("MYGLS_SENDER_IDENTITY_CARD_NUMBER must contain exactly 9 digits when identity type is PIB");
  }
  if (identityType === "PIB" && value("FISCAL_TIN") && senderIdentity !== value("FISCAL_TIN")) {
    errors.push("MyGLS sender PIB does not match FISCAL_TIN");
  }
  const pickupHouseNumber = value("MYGLS_PICKUP_HOUSE_NUMBER");
  if (pickupHouseNumber && !/^\d/.test(pickupHouseNumber)) {
    errors.push("MYGLS_PICKUP_HOUSE_NUMBER must start with a digit; confirm a numeric house number with GLS");
  }
  if (enabled("MYGLS_COD_CARD_ENABLED")) {
    warnings.push("MyGLS card COD is enabled; keep it on only with written GLS contract confirmation");
  }
  if (enabled("MYGLS_CONTACT_SERVICE_ENABLED") || enabled("MYGLS_FLEX_DELIVERY_SERVICE_ENABLED")) {
    warnings.push("Optional MyGLS notification services are enabled; verify contract availability and charges");
  }
  if (myGlsEnv === "production" && !enabled("MYGLS_PRODUCTION_ACCEPTED")) {
    errors.push("MyGLS production is enabled without MYGLS_PRODUCTION_ACCEPTED");
  } else if (myGlsEnv === "test") {
    warnings.push("MyGLS is using the provider test account; no production shipment is created");
  }
}
if (enabled("X_EXPRESS_ENABLED") || enabled("X_EXPRESS_PRODUCTION_ACCEPTED")) {
  const xExpressEnv = (value("X_EXPRESS_ENV") ?? "test").toLowerCase();
  if (!["test", "production"].includes(xExpressEnv)) {
    errors.push("X_EXPRESS_ENV must be test or production");
  }
  requireNames("X Express", [
    "X_EXPRESS_BASE_URL", "X_EXPRESS_API_USER", "X_EXPRESS_API_KEY",
    "X_EXPRESS_CONTRACT_CODE", "X_EXPRESS_CHECK_ADDRESS_PATH", "X_EXPRESS_CREATE_ORDER_PATH",
    "X_EXPRESS_WEBHOOK_API_KEY", "X_EXPRESS_CODE_RANGE_START", "X_EXPRESS_CODE_RANGE_END",
    "X_EXPRESS_PICKUP_NAME", "X_EXPRESS_PICKUP_TOWN_ID", "X_EXPRESS_PICKUP_STREET_NAME",
    "X_EXPRESS_PICKUP_STREET_NUMBER", "X_EXPRESS_PICKUP_LATITUDE", "X_EXPRESS_PICKUP_LONGITUDE",
    "X_EXPRESS_PICKUP_CONTACT_NAME", "X_EXPRESS_PICKUP_CONTACT_PHONE",
  ]);
  if (xExpressEnv === "production" && !enabled("X_EXPRESS_PRODUCTION_ACCEPTED")) {
    errors.push("X Express production is enabled without X_EXPRESS_PRODUCTION_ACCEPTED");
  } else if (xExpressEnv === "test") {
    warnings.push("X Express is using the provider test account; no real pickup is created");
  }
}
if ((value("FISCAL_PROVIDER") ?? "").toLowerCase() === "badi") {
  const badiEnv = (value("BADI_ENV") ?? "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(badiEnv)) {
    errors.push("BADI_ENV must be sandbox or production");
  }
  requireNames("BADI", [
    "BADI_API_KEY",
    "BADI_API_SECRET",
    "BADI_FISCAL_MODE",
    "FISCAL_TIN",
    "FISCAL_LOCATION_ID",
  ]);
  if (badiEnv === "production" && !enabled("BADI_PRODUCTION_ACCEPTED")) {
    errors.push("BADI production is selected without BADI_PRODUCTION_ACCEPTED");
  } else if (badiEnv === "sandbox") {
    warnings.push("BADI is using sandbox; no production fiscal document is created");
  }
  const vpfrNames = ["BADI_VPFR_PFX", "BADI_VPFR_PASSWORD", "BADI_VPFR_PAC"];
  const vpfrCount = vpfrNames.filter((name) => value(name)).length;
  const badiMode = (value("BADI_FISCAL_MODE") ?? (vpfrCount ? "vpfr" : "public")).toLowerCase();
  if (!["public", "vpfr"].includes(badiMode)) {
    errors.push("BADI_FISCAL_MODE must be public or vpfr");
  } else if (badiMode === "vpfr") {
    requireNames("BADI VPFR", vpfrNames);
    requireOneOf("BADI VPFR store", ["BADI_STORE_ID", "BADI_CLIENT_ID"]);
    requireOneOf("BADI VPFR cashier", ["BADI_CASHIER_ID", "FISCAL_CASHIER"]);

    const pac = value("BADI_VPFR_PAC");
    if (pac && !/^[A-Z0-9]{6}$/i.test(pac)) {
      errors.push("BADI_VPFR_PAC must contain exactly 6 alphanumeric characters");
    }
    const pfx = value("BADI_VPFR_PFX")?.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    if (pfx) {
      try {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pfx) || pfx.length % 4 !== 0) {
          throw new Error("invalid base64");
        }
        const bytes = Buffer.from(pfx, "base64");
        if (bytes.length < 256 || bytes[0] !== 0x30) throw new Error("invalid PKCS#12");
      } catch {
        errors.push("BADI_VPFR_PFX must be base64-encoded PKCS#12 content");
      }
    }
  } else {
    requireNames("BADI public API", ["BADI_CLIENT_ID"]);
    if (vpfrCount) errors.push("BADI VPFR credentials are set while BADI_FISCAL_MODE is public");
  }
}
if (enabled("EOTPREMNICA_ENABLED") || enabled("EOTPREMNICA_PRODUCTION_ACCEPTED")) {
  const eotpremnicaEnv = (value("EOTPREMNICA_ENV") ?? "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(eotpremnicaEnv)) {
    errors.push("EOTPREMNICA_ENV must be sandbox or production");
  }
  requireNames("eOtpremnica", ["EOTPREMNICA_BASE_URL", "EOTPREMNICA_API_KEY"]);
  if (eotpremnicaEnv === "production" && !enabled("EOTPREMNICA_PRODUCTION_ACCEPTED")) {
    errors.push(
      "eOtpremnica production is enabled without EOTPREMNICA_PRODUCTION_ACCEPTED",
    );
  } else if (eotpremnicaEnv === "sandbox") {
    warnings.push("eOtpremnica is using sandbox; no production document is submitted");
  }
}
if (enabled("SEF_ENABLED") || enabled("SEF_PRODUCTION_ACCEPTED")) {
  const sefEnv = (value("SEF_ENV") ?? "demo").toLowerCase();
  if (!["demo", "production"].includes(sefEnv)) {
    errors.push("SEF_ENV must be demo or production");
  }
  requireNames("SEF / eFaktura", ["SEF_API_KEY"]);
  if (sefEnv === "production" && !enabled("SEF_PRODUCTION_ACCEPTED")) {
    errors.push("SEF production is enabled without SEF_PRODUCTION_ACCEPTED");
  } else if (sefEnv === "demo") {
    warnings.push("SEF is using demo; no production eInvoice is submitted");
  }
  if (value("SEF_BASE_URL")) publicHttps("SEF_BASE_URL");
}
if (enabled("RABALUX_ENABLED")) {
  requireNames("Rabalux", [
    "RABALUX_CATALOG_USER",
    "RABALUX_CATALOG_PASS",
    "RABALUX_STOCK_USER",
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "EMAIL_FROM",
  ]);
  requireOneOf("Rabalux stock API", [
    "RABALUX_STOCK_API_KEY",
    "RABALUX_STOCK_PASS",
  ]);
  if (emailProvider === "none") {
    errors.push("Rabalux requires transactional email.");
  }
  const mediaWorkers = Number(value("RABALUX_MEDIA_WORKER_CONCURRENCY") ?? "2");
  if (!Number.isInteger(mediaWorkers) || mediaWorkers < 1 || mediaWorkers > 2) {
    errors.push("RABALUX_MEDIA_WORKER_CONCURRENCY must be 1 or 2");
  }
  for (const name of ["RABALUX_MIN_BASELINE_RATIO", "RABALUX_MAX_MISSING_RATIO"]) {
    const configured = value(name);
    const ratio = Number(configured);
    if (configured && (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1)) {
      errors.push(`${name} must be a number greater than 0 and at most 1`);
    }
  }
  for (const name of [
    "RABALUX_SYNC_LEASE_SECONDS",
    "RABALUX_CATALOG_MISSING_CONFIRMATIONS",
    "RABALUX_CATALOG_MISSING_GRACE_HOURS",
    "RABALUX_STOCK_MISSING_CONFIRMATIONS",
    "RABALUX_STOCK_MISSING_GRACE_MINUTES",
    "RABALUX_VIDEO_MAX_BYTES",
  ]) {
    const configured = value(name);
    const number = Number(configured);
    if (configured && (!Number.isInteger(number) || number <= 0)) {
      errors.push(`${name} must be a positive integer`);
    }
  }
  const configuredMaxPriceChange = value("RABALUX_MAX_AUTO_PRICE_CHANGE_PCT");
  const maxPriceChange = Number(configuredMaxPriceChange);
  if (configuredMaxPriceChange && (!Number.isFinite(maxPriceChange) || maxPriceChange < 0)) {
    errors.push("RABALUX_MAX_AUTO_PRICE_CHANGE_PCT must be zero or a positive number");
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
