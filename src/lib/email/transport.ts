import "server-only";

import { getEmailConfig } from "./config";

/**
 * Phase 4D — provider-agnostic dispatcher.
 *
 * Uses native `fetch` so we don't pull in Resend/Postmark SDKs (keeps the
 * Edge build clean — though email send paths run in `nodejs` to allow
 * Buffer-based attachments).
 */

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  contentType?: string;
}

export interface DispatchInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  bcc?: string | string[] | null;
  cc?: string | string[] | null;
  replyTo?: string | null;
  attachments?: EmailAttachment[];
  /** Tags surface in provider analytics; values are coerced to strings. */
  tags?: Record<string, string>;
  /** Idempotency key (Resend supports this natively). */
  idempotencyKey?: string;
}

export type DispatchResult =
  | { ok: true; id: string; provider: "resend" | "postmark" | "none" }
  | { ok: false; error: string; provider: "resend" | "postmark" | "none" };

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const cfg = getEmailConfig();

  if (cfg.provider === "none" || !cfg.apiKey) {
    // Dev / preview — print a one-line summary so the trigger is visible
    // in logs without leaking the full body.
    const to = Array.isArray(input.to) ? input.to.join(",") : input.to;
    console.info(
      `[email:dev] to=${to} subject=${JSON.stringify(input.subject)} bytes=${input.html.length}`,
    );
    return { ok: true, id: `dev-${Date.now()}`, provider: "none" };
  }

  try {
    if (cfg.provider === "resend") {
      return await dispatchResend(input, cfg.apiKey, cfg.from, cfg.replyTo);
    }
    return await dispatchPostmark(input, cfg.apiKey, cfg.from, cfg.replyTo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, provider: cfg.provider };
  }
}

async function dispatchResend(
  input: DispatchInput,
  apiKey: string,
  from: string,
  replyTo: string | null,
): Promise<DispatchResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.text) body.text = input.text;
  if (input.bcc) body.bcc = Array.isArray(input.bcc) ? input.bcc : [input.bcc];
  if (input.cc) body.cc = Array.isArray(input.cc) ? input.cc : [input.cc];
  if (input.replyTo ?? replyTo) body.reply_to = input.replyTo ?? replyTo;
  if (input.attachments?.length) {
    body.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType,
    }));
  }
  if (input.tags) {
    body.tags = Object.entries(input.tags).map(([name, value]) => ({
      name,
      value,
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: `resend:${res.status} ${json.message ?? json.name ?? "unknown"}`,
      provider: "resend",
    };
  }
  return { ok: true, id: json.id ?? "unknown", provider: "resend" };
}

async function dispatchPostmark(
  input: DispatchInput,
  token: string,
  from: string,
  replyTo: string | null,
): Promise<DispatchResult> {
  const body: Record<string, unknown> = {
    From: from,
    To: Array.isArray(input.to) ? input.to.join(",") : input.to,
    Subject: input.subject,
    HtmlBody: input.html,
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
  };
  if (input.text) body.TextBody = input.text;
  if (input.bcc)
    body.Bcc = Array.isArray(input.bcc) ? input.bcc.join(",") : input.bcc;
  if (input.cc)
    body.Cc = Array.isArray(input.cc) ? input.cc.join(",") : input.cc;
  if (input.replyTo ?? replyTo) body.ReplyTo = input.replyTo ?? replyTo;
  if (input.attachments?.length) {
    body.Attachments = input.attachments.map((a) => ({
      Name: a.filename,
      Content: a.content,
      ContentType: a.contentType ?? "application/octet-stream",
    }));
  }
  if (input.tags) {
    body.Metadata = input.tags;
  }

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    MessageID?: string;
    Message?: string;
    ErrorCode?: number;
  };
  if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
    return {
      ok: false,
      error: `postmark:${res.status} ${json.Message ?? "unknown"}`,
      provider: "postmark",
    };
  }
  return { ok: true, id: json.MessageID ?? "unknown", provider: "postmark" };
}
