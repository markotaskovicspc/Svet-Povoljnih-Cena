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
    to: toList(data.to),
    subject,
    text,
    messageId: pickString(data.message_id),
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
  };
}

export type InboundRouteResult =
  | { ok: true; route: "reclamation" | "comment"; commentId: string }
  | { ok: false; reason: "no_match" | "duplicate" | "empty" };

export async function handleInboundMessage(
  msg: InboundMessage,
): Promise<InboundRouteResult> {
  if (!msg.text.trim()) return { ok: false, reason: "empty" };

  const cfg = getEmailConfig();
  const recipients = msg.to.map((t) => t.toLowerCase());
  const reclamation = recipients.includes(cfg.reclamationsInbox.toLowerCase());
  const comment = recipients.includes(cfg.commentsInbox.toLowerCase());

  if (!reclamation && !comment) return { ok: false, reason: "no_match" };

  if (msg.messageId) {
    const existing = await db.comment.findFirst({
      where: { subject: { startsWith: `[in:${msg.messageId}]` } },
      select: { id: true },
    });
    if (existing)
      return {
        ok: true,
        route: reclamation ? "reclamation" : "comment",
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
      body: msg.text.slice(0, 5000),
    },
    select: { id: true },
  });

  return {
    ok: true,
    route: reclamation ? "reclamation" : "comment",
    commentId: created.id,
  };
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
function parseAddress(s: string): { name: string | null; address: string } {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] || "").trim() || null, address: m[2]!.trim() };
  return { name: null, address: s.trim() };
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
