import "server-only";

import { getViberConfig, isViberReady, type ViberProvider } from "./config";
import { dispatchNth } from "./nth";

/**
 * Phase 4E — provider-agnostic Viber dispatcher.
 *
 * Returns a normalized result so the campaign runner can tally
 * delivered/failed counts without knowing about provider error shapes.
 */

export interface ViberMessage {
  /** Recipient Viber subscriber id (PA-scoped) OR E.164 phone number. */
  to: string;
  text: string;
  imageUrl?: string | null;
  cta?: { label: string; url: string } | null;
  /** Free-form correlation id surfaced in delivery-report webhooks. */
  trackingData?: string;
  kind?: "promotion" | "transaction";
  template?: { id: string; lang: string; parameters?: Record<string, string> };
  requestId?: string;
}

export type ViberDispatchResult =
  | { ok: true; messageToken: string; provider: ViberProvider }
  | { ok: false; error: string; provider: ViberProvider };

/**
 * Send a single Viber message. Idempotency is the caller's responsibility
 * (`trackingData` is correlation only, not a provider deduplication guarantee).
 * Ambiguous writes are not automatically retried.
 */
export async function dispatch(
  msg: ViberMessage,
): Promise<ViberDispatchResult> {
  const cfg = getViberConfig();

  if (!isViberReady()) {
    return { ok: false, error: "viber:not_configured_or_not_accepted", provider: cfg.provider };
  }
  if (cfg.provider === "nth") {
    if (cfg.deliveryMode === "worker") {
      const { queueNthMessage } = await import("./outbox");
      return queueNthMessage(msg, cfg);
    }
    return dispatchNth(msg, cfg);
  }
  if (!cfg.apiKey) return { ok: false, error: "viber:missing_api_token", provider: "viber" };

  return dispatchOfficial(msg, cfg.apiKey, cfg.sender, cfg.senderAvatar, cfg.endpoint);
}

async function dispatchOfficial(
  msg: ViberMessage,
  apiKey: string,
  senderName: string,
  senderAvatar: string | null,
  endpoint: string,
): Promise<ViberDispatchResult> {
  // Rakuten Viber for Business — `pa/send_message` payload.
  // https://developers.viber.com/docs/api/rest-bot-api/#send-message
  const sender: Record<string, string> = { name: senderName };
  if (senderAvatar) sender.avatar = senderAvatar;

  const body = buildOfficialPayload(msg, sender);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Viber-Auth-Token": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `viber:network ${message}`, provider: "viber" };
  }

  const json = (await res.json().catch(() => ({}))) as {
    status?: number;
    status_message?: string;
    message_token?: number | string;
  };
  // Viber returns HTTP 200 even on logical failures; status === 0 means OK.
  if (!res.ok || json.status !== 0 || !json.message_token) {
    return {
      ok: false,
      error: `viber:${json.status ?? res.status} ${json.status_message ?? "unknown"}`,
      provider: "viber",
    };
  }

  return {
    ok: true,
    messageToken: String(json.message_token ?? "unknown"),
    provider: "viber",
  };
}

function buildOfficialPayload(msg: ViberMessage, sender: Record<string, string>) {
  const base: Record<string, unknown> = {
    receiver: msg.to,
    sender,
    min_api_version: 2,
  };
  if (msg.trackingData) base.tracking_data = msg.trackingData;

  if (msg.imageUrl && msg.cta) {
    // Rich media carousel: image + button.
    base.type = "rich_media";
    base.rich_media = {
      Type: "rich_media",
      ButtonsGroupColumns: 6,
      ButtonsGroupRows: 7,
      BgColor: "#FAF7F2",
      Buttons: [
        {
          Columns: 6,
          Rows: 5,
          ActionType: "open-url",
          ActionBody: msg.cta.url,
          Image: msg.imageUrl,
        },
        {
          Columns: 6,
          Rows: 1,
          Text: `<font color=\"#1A1714\">${escapeHtml(msg.text)}</font>`,
          ActionType: "reply",
          ActionBody: "noop",
          TextSize: "medium",
          TextHAlign: "left",
        },
        {
          Columns: 6,
          Rows: 1,
          ActionType: "open-url",
          ActionBody: msg.cta.url,
          Text: `<b>${escapeHtml(msg.cta.label)}</b>`,
          TextSize: "regular",
          TextHAlign: "center",
          BgColor: "#6B4423",
          TextColor: "#FFFFFF",
        },
      ],
    };
    return base;
  }

  if (msg.imageUrl) {
    base.type = "picture";
    base.text = msg.text;
    base.media = msg.imageUrl;
    return base;
  }

  base.type = "text";
  base.text = msg.cta ? `${msg.text}\n\n${msg.cta.label}: ${msg.cta.url}` : msg.text;
  return base;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
