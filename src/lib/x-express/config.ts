import "server-only";

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
  baseUrl: string;
  apiUser: string;
  apiKey: string;
  webhookApiKey: string;
  contractCode: string;
  codePrefix: string;
  codeRangeStart: number | null;
  codeRangeEnd: number | null;
  statusCronSecret: string;
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
  return value?.trim() ?? "";
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

export function getXExpressConfig(): XExpressConfig {
  return {
    enabled: bool(process.env.X_EXPRESS_ENABLED),
    autoCreate: bool(process.env.X_EXPRESS_AUTO_CREATE),
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
