export type EotpremnicaMode = "sandbox" | "production";

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function resolveEotpremnicaGate(
  env: Record<string, string | undefined> = process.env,
) {
  const mode = env.EOTPREMNICA_ENV?.trim().toLowerCase();
  if (!enabled(env.EOTPREMNICA_ENABLED)) {
    return { allowed: false as const, reason: "EOTPREMNICA_ENABLED nije uključena." };
  }
  if (mode !== "sandbox" && mode !== "production") {
    return {
      allowed: false as const,
      reason: "EOTPREMNICA_ENV mora biti sandbox ili production.",
    };
  }
  if (mode === "production" && !enabled(env.EOTPREMNICA_PRODUCTION_ACCEPTED)) {
    return {
      allowed: false as const,
      reason:
        "Produkcijska eOtpremnica je zaključana dok EOTPREMNICA_PRODUCTION_ACCEPTED nije eksplicitno true.",
    };
  }
  return { allowed: true as const, mode: mode as EotpremnicaMode };
}
