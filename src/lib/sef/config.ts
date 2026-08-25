export type SefEnvironment = "demo" | "production";

export type SefConfig = {
  environment: SefEnvironment;
  baseUrl: string;
  apiKey: string;
};

const DEFAULT_BASE_URLS: Record<SefEnvironment, string> = {
  demo: "https://demoefaktura.mfin.gov.rs",
  production: "https://efaktura.mfin.gov.rs",
};

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

function configured(value: string | undefined) {
  const item = value?.trim();
  if (
    !item ||
    item.startsWith("GET_FROM_") ||
    item.includes("CHANGE_ME") ||
    item.toLowerCase().includes("placeholder")
  ) {
    return null;
  }
  return item;
}

export function resolveSefGate(
  env: Record<string, string | undefined> = process.env,
) {
  if (!enabled(env.SEF_ENABLED)) {
    return { allowed: false as const, reason: "SEF_ENABLED nije uključena." };
  }
  const environment = env.SEF_ENV?.trim().toLowerCase();
  if (environment !== "demo" && environment !== "production") {
    return {
      allowed: false as const,
      reason: "SEF_ENV mora biti demo ili production.",
    };
  }
  if (
    environment === "production" &&
    !enabled(env.SEF_PRODUCTION_ACCEPTED)
  ) {
    return {
      allowed: false as const,
      reason:
        "Produkcijski SEF je zaključan dok SEF_PRODUCTION_ACCEPTED nije eksplicitno true.",
    };
  }
  return { allowed: true as const, environment: environment as SefEnvironment };
}

export function requireSefConfig(
  env: Record<string, string | undefined> = process.env,
): SefConfig {
  const gate = resolveSefGate(env);
  if (!gate.allowed) throw new Error(gate.reason);

  const apiKey = configured(env.SEF_API_KEY);
  if (!apiKey) throw new Error("SEF_API_KEY nije podešen.");

  const baseUrl = (
    configured(env.SEF_BASE_URL) ?? DEFAULT_BASE_URLS[gate.environment]
  ).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("SEF_BASE_URL nije ispravna URL adresa.");
  }
  if (gate.environment === "production" && parsed.protocol !== "https:") {
    throw new Error("Produkcijski SEF_BASE_URL mora koristiti HTTPS.");
  }

  return { environment: gate.environment, baseUrl, apiKey };
}
