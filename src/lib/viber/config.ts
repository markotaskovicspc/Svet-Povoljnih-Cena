import "server-only";
import { BRAND } from "@/lib/brand";
import { envValue } from "@/lib/env";
import { isProviderAccepted } from "@/lib/provider-acceptance";

/**
 * Phase 4E — Viber Business Messages configuration.
 *
 * Provider is selected via `VIBER_PROVIDER`:
 *   - `viber`   → Rakuten Viber for Business (chatapi.viber.com).
 *   - `none`    → Dev/preview stub: `dispatch()` logs to stdout and reports
 *                 success without contacting any external service.
 *
 * The transport is provider-agnostic so we can swap to a regional
 * aggregator (Infobip, Routee, …) later without touching the campaign /
 * audience layer.
 */

export type ViberProvider = "viber" | "none";

export interface ViberConfig {
  provider: ViberProvider;
  /** API token (X-Viber-Auth-Token for the official API). */
  apiKey: string | null;
  /** Sender display name printed above the message bubble. */
  sender: string;
  /** Optional sender avatar URL (PNG, < 100 KB). */
  senderAvatar: string | null;
  /** Endpoint for the chosen provider. */
  endpoint: string;
  /** Shared secret used to verify inbound delivery-report webhooks. */
  webhookSecret: string | null;
  /** Public base URL for absolute CTA links. */
  baseUrl: string;
}

let cached: ViberConfig | null = null;

export function getViberConfig(): ViberConfig {
  if (cached) return cached;
  const raw = (process.env.VIBER_PROVIDER ?? "none").toLowerCase();
  const provider: ViberProvider =
    raw === "viber" && isProviderAccepted("VIBER_PRODUCTION_ACCEPTED")
      ? "viber"
      : "none";

  cached = {
    provider,
    apiKey: provider === "viber" ? envValue("VIBER_API_TOKEN") : null,
    sender: process.env.VIBER_SENDER_NAME ?? BRAND.name,
    senderAvatar: process.env.VIBER_SENDER_AVATAR ?? null,
    endpoint:
      process.env.VIBER_ENDPOINT ?? "https://chatapi.viber.com/pa/send_message",
    webhookSecret: process.env.VIBER_WEBHOOK_SECRET ?? null,
    baseUrl:
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      "https://www.svetpovoljnihcena.rs",
  };
  return cached;
}

/** Test-only: reset the cached config so env changes are picked up. */
export function __resetViberConfig() {
  cached = null;
}
