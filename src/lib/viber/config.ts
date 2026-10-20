import "server-only";
import { BRAND } from "@/lib/brand";
import { envValue } from "@/lib/env";
import { isProviderAccepted } from "@/lib/provider-acceptance";

/**
 * Phase 4E — Viber Business Messages configuration.
 *
 * Provider is selected via `VIBER_PROVIDER`:
 *   - `viber`   → Rakuten Viber for Business (chatapi.viber.com).
 *   - `nth`     → NTH Omni-channel Business Messages, phone-number delivery.
 *   - `none`    → Disabled; dispatch reports a configuration error.
 *
 * The transport is provider-agnostic so we can swap to a regional
 * aggregator later without touching the campaign /
 * audience layer.
 */

export type ViberProvider = "viber" | "nth" | "none";

export interface ViberConfig {
  provider: ViberProvider;
  /** API token (X-Viber-Auth-Token for the official API). */
  apiKey: string | null;
  username: string | null;
  password: string | null;
  accepted: boolean;
  deliveryMode: "direct" | "worker";
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
    raw === "viber" || raw === "nth"
      ? raw
      : "none";

  cached = {
    provider,
    apiKey: provider === "viber" ? envValue("VIBER_API_TOKEN") : null,
    username: envValue("NTH_API_USERNAME"),
    password: envValue("NTH_API_PASSWORD"),
    deliveryMode: envValue("NTH_DELIVERY_MODE") === "worker" ? "worker" : "direct",
    accepted: isProviderAccepted("VIBER_PRODUCTION_ACCEPTED"),
    sender: envValue("VIBER_SENDER_NAME") ?? BRAND.name,
    senderAvatar: process.env.VIBER_SENDER_AVATAR ?? null,
    endpoint:
      provider === "nth"
        ? `${(envValue("NTH_API_BASE_URL") ?? "https://msg.mobile-gw.com:9000").replace(/\/$/, "")}/v1/omni-channel/message`
        : envValue("VIBER_ENDPOINT") ?? "https://chatapi.viber.com/pa/send_message",
    webhookSecret: envValue("VIBER_WEBHOOK_SECRET"),
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

export function isViberReady() {
  const cfg = getViberConfig();
  return cfg.accepted && (cfg.provider === "nth"
    ? (cfg.deliveryMode === "worker" ? Boolean(envValue("NTH_WORKER_TOKEN") && envValue("NTH_WORKER_TOKEN")!.length >= 32) : Boolean(cfg.username && cfg.password))
    : cfg.provider === "viber" && Boolean(cfg.apiKey));
}
