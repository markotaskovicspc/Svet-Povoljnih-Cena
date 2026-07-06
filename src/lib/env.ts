import "server-only";

/**
 * `.env.local` carries truthy `GET_FROM_...` placeholder secrets (QA finding:
 * they pass "is this configured" presence checks and then fail at the real
 * API call). Read provider secrets through this helper so placeholders count
 * as unset and integrations degrade to their dev/stub paths instead.
 */
export function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("GET_FROM_")) return null;
  return value;
}
