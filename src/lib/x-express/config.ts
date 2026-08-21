import "server-only";
import { isProviderAccepted } from "@/lib/provider-acceptance";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const X_EXPRESS_PROVIDER = "X_EXPRESS";

export class XExpressConfigError extends Error {}
export class XExpressProviderError extends Error {
  constructor(
    message: string,
    public readonly providerCode?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
  }
}

export interface XExpressConfig {
  enabled: boolean;
  autoCreate: boolean;
  env: "test" | "production";
  baseUrl: string;
  apiUser: string;
  apiKey: string;
  webhookApiKey: string;
  contractCode: string;
  codePrefix: string;
  codeRangeStart: number | null;
  codeRangeEnd: number | null;
  statusCronSecret: string;
  servicePayerId: number;
  serviceTypeId: number;
  defaultContent: string;
  pickup: {
    name: string;
    townId: number | null;
    streetName: string;
    streetNumber: string;
    latitude: number | null;
    longitude: number | null;
    description: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
  };
  cod: {
    name: string;
    account: string;
    address: string;
  };
  paths: {
    municipalities: string;
    towns: string;
    streets: string;
    statuses: string;
    checkAddress: string;
    createOrder: string;
    status: string;
  };
}

function trim(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized && !normalized.startsWith("GET_FROM_") ? normalized : "";
}

function bool(value: string | undefined, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function decimal(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getXExpressConfig(): XExpressConfig {
  const env = trim(process.env.X_EXPRESS_ENV).toLowerCase() === "production"
    ? "production"
    : "test";
  return {
    enabled:
      bool(process.env.X_EXPRESS_ENABLED) &&
      (env === "test" || isProviderAccepted("X_EXPRESS_PRODUCTION_ACCEPTED")),
    autoCreate: bool(process.env.X_EXPRESS_AUTO_CREATE),
    env,
    baseUrl:
      trim(process.env.X_EXPRESS_BASE_URL).replace(/\/+$/, "") ||
      "https://portal.pm.xexpress.rs",
    apiUser: trim(process.env.X_EXPRESS_API_USER),
    apiKey: trim(process.env.X_EXPRESS_API_KEY),
    webhookApiKey:
      trim(process.env.X_EXPRESS_WEBHOOK_API_KEY) ||
      trim(process.env.X_EXPRESS_WEBHOOK_SECRET),
    contractCode: trim(process.env.X_EXPRESS_CONTRACT_CODE),
    codePrefix: trim(process.env.X_EXPRESS_CODE_PREFIX) || "AAA",
    codeRangeStart: int(process.env.X_EXPRESS_CODE_RANGE_START),
    codeRangeEnd: int(process.env.X_EXPRESS_CODE_RANGE_END),
    statusCronSecret: trim(process.env.X_EXPRESS_STATUS_CRON_SECRET),
    servicePayerId: int(process.env.X_EXPRESS_SERVICE_PAYER_ID) ?? 1,
    serviceTypeId: int(process.env.X_EXPRESS_SERVICE_TYPE_ID) ?? 1,
    defaultContent:
      trim(process.env.X_EXPRESS_DEFAULT_CONTENT) || "Webshop porudžbina",
    pickup: {
      name: trim(process.env.X_EXPRESS_PICKUP_NAME),
      townId: int(process.env.X_EXPRESS_PICKUP_TOWN_ID),
      streetName: trim(process.env.X_EXPRESS_PICKUP_STREET_NAME),
      streetNumber: trim(process.env.X_EXPRESS_PICKUP_STREET_NUMBER),
      latitude: decimal(process.env.X_EXPRESS_PICKUP_LATITUDE),
      longitude: decimal(process.env.X_EXPRESS_PICKUP_LONGITUDE),
      description: trim(process.env.X_EXPRESS_PICKUP_DESCRIPTION),
      contactName: trim(process.env.X_EXPRESS_PICKUP_CONTACT_NAME),
      contactPhone: trim(process.env.X_EXPRESS_PICKUP_CONTACT_PHONE),
      contactEmail: trim(process.env.X_EXPRESS_PICKUP_CONTACT_EMAIL),
    },
    cod: {
      name: trim(process.env.X_EXPRESS_COD_NAME) || MERCHANT_LEGAL_INFO.name,
      account:
        trim(process.env.X_EXPRESS_COD_ACCOUNT) || MERCHANT_LEGAL_INFO.bankAccount,
      address:
        trim(process.env.X_EXPRESS_COD_ADDRESS) || MERCHANT_LEGAL_INFO.shortAddress,
    },
    paths: {
      municipalities:
        trim(process.env.X_EXPRESS_MUNICIPALITIES_PATH) ||
        "/api/data/municipalities",
      towns:
        trim(process.env.X_EXPRESS_TOWNS_PATH) ||
        trim(process.env.X_EXPRESS_LOCATIONS_PATH) ||
        "/api/data/towns",
      streets: trim(process.env.X_EXPRESS_STREETS_PATH) || "/api/data/streets",
      statuses: trim(process.env.X_EXPRESS_STATUSES_PATH) || "/api/data/statuses",
      checkAddress:
        trim(process.env.X_EXPRESS_CHECK_ADDRESS_PATH) ||
        "/api/order/check-address",
      createOrder: trim(process.env.X_EXPRESS_CREATE_ORDER_PATH),
      status: trim(process.env.X_EXPRESS_STATUS_PATH),
    },
  };
}

export function requireXExpressEnabled() {
  const cfg = getXExpressConfig();
  if (!cfg.enabled) {
    throw new XExpressConfigError("X Express integracija nije uključena.");
  }
  if (!cfg.baseUrl || !cfg.apiUser || !cfg.apiKey || !cfg.contractCode) {
    throw new XExpressConfigError(
      "X Express konfiguracija nije kompletna. Proverite base URL, x-api-user, x-api-key i contractCode.",
    );
  }
  return cfg;
}

export function requireXExpressShipmentConfig(cashOnDelivery = false) {
  const cfg = requireXExpressEnabled();
  requireXExpressPath(cfg, "checkAddress");
  requireXExpressPath(cfg, "createOrder");
  if (
    cfg.codeRangeStart == null ||
    cfg.codeRangeEnd == null ||
    cfg.codeRangeStart > cfg.codeRangeEnd
  ) {
    throw new XExpressConfigError("X Express opseg kodova nije ispravno podešen.");
  }
  if (!/^U\d{6}$/.test(cfg.contractCode)) {
    throw new XExpressConfigError("X Express contract code mora biti u formatu U + 6 cifara.");
  }
  if (!/^[A-Z]{3}$/.test(cfg.codePrefix)) {
    throw new XExpressConfigError("X Express code prefix mora imati tačno tri velika slova.");
  }
  if (
    cfg.codePrefix === "AAA" &&
    cfg.codeRangeStart === 850300000 &&
    cfg.codeRangeEnd === 850599999
  ) {
    throw new XExpressConfigError(
      "X Express je podešen na primer opsega AAA/850300000–850599999. Zatražite stvarno dodeljeni prefiks i opseg kodova.",
    );
  }
  if (![1, 2, 3, 4].includes(cfg.servicePayerId)) {
    throw new XExpressConfigError("X Express ServicePayerId mora biti 1, 2, 3 ili 4.");
  }
  if (cfg.serviceTypeId !== 1) {
    throw new XExpressConfigError("X Express trenutno podržava TypeId=1.");
  }

  const requiredPickup: Array<[string, unknown]> = [
    ["X_EXPRESS_PICKUP_NAME", cfg.pickup.name],
    ["X_EXPRESS_PICKUP_TOWN_ID", cfg.pickup.townId],
    ["X_EXPRESS_PICKUP_STREET_NAME", cfg.pickup.streetName],
    ["X_EXPRESS_PICKUP_STREET_NUMBER", cfg.pickup.streetNumber],
    ["X_EXPRESS_PICKUP_LATITUDE", cfg.pickup.latitude],
    ["X_EXPRESS_PICKUP_LONGITUDE", cfg.pickup.longitude],
    ["X_EXPRESS_PICKUP_CONTACT_NAME", cfg.pickup.contactName],
    ["X_EXPRESS_PICKUP_CONTACT_PHONE", cfg.pickup.contactPhone],
  ];
  const missing = requiredPickup
    .filter(([, value]) => value == null || value === "")
    .map(([name]) => name);
  if (missing.length) {
    throw new XExpressConfigError(
      `X Express pickup konfiguracija nije kompletna: ${missing.join(", ")}.`,
    );
  }
  if (cfg.pickup.townId! <= 0) {
    throw new XExpressConfigError("X_EXPRESS_PICKUP_TOWN_ID mora biti pozitivan broj.");
  }
  if (Math.abs(cfg.pickup.latitude!) > 90 || Math.abs(cfg.pickup.longitude!) > 180) {
    throw new XExpressConfigError("X Express pickup koordinate nisu validne.");
  }
  if (
    cashOnDelivery &&
    (!cfg.cod.name || !cfg.cod.account || !cfg.cod.address)
  ) {
    throw new XExpressConfigError("X Express COD podaci nisu kompletni.");
  }
  return cfg;
}

export function requireXExpressPath(
  cfg: XExpressConfig,
  key: keyof XExpressConfig["paths"],
) {
  const path = cfg.paths[key];
  if (!path) {
    throw new XExpressConfigError(
      `X Express endpoint path nije podešen: X_EXPRESS_${envPathKey(key)}.`,
    );
  }
  return path;
}

function envPathKey(key: keyof XExpressConfig["paths"]) {
  switch (key) {
    case "municipalities":
      return "MUNICIPALITIES_PATH";
    case "towns":
      return "TOWNS_PATH";
    case "streets":
      return "STREETS_PATH";
    case "statuses":
      return "STATUSES_PATH";
    case "checkAddress":
      return "CHECK_ADDRESS_PATH";
    case "createOrder":
      return "CREATE_ORDER_PATH";
    case "status":
      return "STATUS_PATH";
  }
}

export function joinXExpressUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function buildXExpressStatusPath(path: string, trackingNo: string) {
  const encoded = encodeURIComponent(trackingNo);
  if (path.includes("{trackingNo}")) {
    return path.replaceAll("{trackingNo}", encoded);
  }
  if (path.includes(":trackingNo")) {
    return path.replaceAll(":trackingNo", encoded);
  }
  return `${path.replace(/\/+$/, "")}/${encoded}`;
}

export function redactXExpressSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    const cfg = getXExpressConfig();
    return [cfg.apiUser, cfg.apiKey].reduce((acc, secret) => {
      if (!secret) return acc;
      return acc.replaceAll(secret, "[redacted]");
    }, input);
  }
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactXExpressSecrets);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/api[-_]?key|api[-_]?user|password|secret|token/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactXExpressSecrets(value);
    }
  }
  return redacted;
}
