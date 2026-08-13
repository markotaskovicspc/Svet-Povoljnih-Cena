import "server-only";

import { db } from "@/lib/db";
import { getEmailConfig } from "./config";

/**
 * Phase 4D — inbound email parsing.
 *
 * Both Resend and Postmark POST a JSON payload to our webhook with the
 * parsed message. We accept either shape and persist messages addressed to
 * `reklamacije@…` or `komentar@…` as `Comment` rows that admin will triage
 * (reklamacije without a structured form lack the SKU/order fields the
 * `Reclamation` model requires).
 */

export interface InboundMessage {
  from: string;
  fromName: string | null;
  to: string[];
  subject: string;
  text: string;
  messageId: string | null;
  attachments: InboundAttachmentMetadata[];
}

export interface InboundAttachmentMetadata {
  id: string;
  filename: string;
  contentType: string;
  contentDisposition: string | null;
  size: number | null;
}

/** Best-effort normalizer for both Resend and Postmark inbound payloads. */
export function normalizeInbound(raw: unknown): InboundMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // Resend (`type: "email.received"`, `data: {…}`).
  if (typeof r.type === "string" && r.data && typeof r.data === "object") {
    const data = r.data as Record<string, unknown>;
    return resend(data);
  }
  if ("from" in r && "subject" in r && ("text" in r || "html" in r)) {
    return resend(r);
  }

  // Postmark inbound (top-level fields like `From`, `ToFull`, `TextBody`).
  if ("From" in r && ("TextBody" in r || "HtmlBody" in r)) {
    return postmark(r);
  }
  return null;
}

function resend(data: Record<string, unknown>): InboundMessage | null {
  const from = pickString(data.from);
  const subject = pickString(data.subject) ?? "(bez naslova)";
  const text = pickString(data.text) ?? stripHtml(pickString(data.html) ?? "");
  if (!from) return null;
  const fromAddr = parseAddress(from);
  return {
    from: fromAddr.address,
    fromName: fromAddr.name,
    to: [...new Set([...toList(data.to), ...toList(data.received_for)])],
    subject,
    text,
    messageId:
      pickString(data.id) ??
      pickString(data.email_id) ??
      pickString(data.message_id),
    attachments: attachmentList(data.attachments),
  };
}

function postmark(data: Record<string, unknown>): InboundMessage | null {
  const fromRaw = pickString(data.From);
  if (!fromRaw) return null;
  const fromAddr = parseAddress(fromRaw);
  const to: string[] = [];
  const toFull = data.ToFull;
  if (Array.isArray(toFull)) {
    for (const entry of toFull) {
      if (entry && typeof entry === "object") {
        const addr = pickString((entry as Record<string, unknown>).Email);
        if (addr) to.push(addr.toLowerCase());
      }
    }
  } else {
    to.push(...toList(data.To));
  }
  return {
    from: fromAddr.address,
    fromName: pickString(data.FromName) ?? fromAddr.name,
    to,
    subject: pickString(data.Subject) ?? "(bez naslova)",
    text: pickString(data.TextBody) ?? stripHtml(pickString(data.HtmlBody) ?? ""),
    messageId: pickString(data.MessageID),
    attachments: [],
  };
}

export type InboundRouteResult =
  | { ok: true; route: "reclamation" | "comment"; commentId: string }
  | { ok: false; reason: "no_match" | "duplicate" | "empty" };

export async function handleInboundMessage(
  msg: InboundMessage,
): Promise<InboundRouteResult> {
  const route = classifyInboundMessage(msg);
  if (!route) return { ok: false, reason: "no_match" };
  if (!msg.text.trim() && !msg.attachments.length) {
    return { ok: false, reason: "empty" };
  }
  const reclamation = route === "reclamation";

  if (msg.messageId) {
    const existing = await db.comment.findFirst({
      where: { subject: { startsWith: `[in:${msg.messageId}]` } },
      select: { id: true },
    });
    if (existing)
      return {
        ok: true,
        route,
        commentId: existing.id,
      };
  }

  const subjectPrefix = reclamation ? "[reklamacija]" : "[komentar]";
  const messageTag = msg.messageId ? `[in:${msg.messageId}] ` : "";
  const created = await db.comment.create({
    data: {
      name: msg.fromName ?? msg.from,
      email: msg.from,
      subject: `${messageTag}${subjectPrefix} ${msg.subject}`.slice(0, 160),
      body: (msg.text.trim() || "Poruka nema tekst; pogledajte priloge.").slice(
        0,
        5000,
      ),
    },
    select: { id: true },
  });

  return {
    ok: true,
    route,
    commentId: created.id,
  };
}

export function classifyInboundMessage(
  msg: Pick<InboundMessage, "to">,
): "reclamation" | "comment" | null {
  const cfg = getEmailConfig();
  const recipients = msg.to.map((recipient) => recipient.trim().toLowerCase());
  if (recipients.includes(cfg.reclamationsInbox.toLowerCase())) {
    return "reclamation";
  }
  if (recipients.includes(cfg.commentsInbox.toLowerCase())) return "comment";
  return null;
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function toList(v: unknown): string[] {
  if (Array.isArray(v))
    return v.map((x) => parseAddress(String(x)).address.toLowerCase());
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => parseAddress(s).address.toLowerCase())
      .filter(Boolean);
  return [];
}
function attachmentList(v: unknown): InboundAttachmentMetadata[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const id = pickString(item.id);
    const filename = pickString(item.filename);
    const contentType = pickString(item.content_type);
    if (!id || !filename || !contentType) return [];
    const rawSize = item.size;
    return [
      {
        id,
        filename,
        contentType: contentType.toLowerCase(),
        contentDisposition: pickString(item.content_disposition),
        size:
          typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0
            ? rawSize
            : null,
      },
    ];
  });
}
function parseAddress(s: string): { name: string | null; address: string } {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || "").trim() || null, address: m[2]!.trim() };
  return { name: null, address: s.trim() };
}
function stripHtml(s: string): string {
  return s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
