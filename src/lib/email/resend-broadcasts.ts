import "server-only";

import { getEmailConfig } from "./config";
import { fetchResendApi } from "./resend-api";

type ResendBroadcastInput = {
  name: string;
  segmentId: string;
  subject: string;
  previewText?: string | null;
  html: string;
  text: string;
  from: string;
  replyTo?: string | null;
  topicId?: string | null;
};

export async function createResendSegment(name: string) {
  const result = await resendJson("POST", "/segments", { name });
  return { id: requiredId(result, "Resend nije vratio ID segmenta.") };
}

export async function addResendContactToSegment(email: string, segmentId: string) {
  await resendJson(
    "POST",
    `/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentId)}`,
  );
}

export async function removeResendContactFromSegment(email: string, segmentId: string) {
  await resendJson(
    "DELETE",
    `/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentId)}`,
    undefined,
    [404],
  );
}

export async function listResendSegmentContactEmails(segmentId: string) {
  const emails: string[] = [];
  let after: string | null = null;
  for (;;) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const result = await resendJson(
      "GET",
      `/segments/${encodeURIComponent(segmentId)}/contacts?${query}`,
    ) as {
      data?: Array<{ id?: unknown; email?: unknown }>;
      has_more?: unknown;
    };
    const rows = Array.isArray(result.data) ? result.data : [];
    for (const row of rows) {
      if (typeof row.email === "string" && row.email) emails.push(row.email.toLowerCase());
    }
    if (result.has_more !== true) break;
    const cursor = rows.at(-1)?.id;
    if (typeof cursor !== "string" || !cursor) {
      throw new Error("Resend segment ima nepotpunu paginaciju.");
    }
    after = cursor;
  }
  return emails;
}

export async function createResendBroadcast(input: ResendBroadcastInput) {
  const result = await resendJson("POST", "/broadcasts", {
    name: input.name,
    segment_id: input.segmentId,
    subject: input.subject,
    preview_text: input.previewText || undefined,
    html: input.html,
    text: input.text,
    from: input.from,
    reply_to: input.replyTo || undefined,
    topic_id: input.topicId || undefined,
  });
  return { id: requiredId(result, "Resend nije vratio ID broadcast-a.") };
}

export async function sendResendBroadcast(broadcastId: string) {
  await resendJson("POST", `/broadcasts/${encodeURIComponent(broadcastId)}/send`, {});
}

export async function getResendBroadcast(broadcastId: string) {
  return resendJson("GET", `/broadcasts/${encodeURIComponent(broadcastId)}`) as Promise<{
    id?: string;
    status?: "draft" | "scheduled" | "queued" | "sent";
    scheduled_at?: string | null;
    sent_at?: string | null;
  }>;
}

export async function cancelResendBroadcast(broadcastId: string) {
  await resendJson("DELETE", `/broadcasts/${encodeURIComponent(broadcastId)}`);
}

async function resendJson(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  acceptedStatuses: number[] = [],
) {
  const cfg = getEmailConfig();
  if (cfg.provider !== "resend" || !cfg.apiKey) {
    throw new Error("Resend nije konfigurisan.");
  }
  const response = await fetchResendApi(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "SvetPovoljnihCena-Broadcasts/1.0",
    },
    ...(body ? { body: JSON.stringify(prune(body)) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(
      `Resend ${method} ${path}: ${response.status} ${String(payload.message ?? payload.name ?? "nepoznata greška")}`,
    );
  }
  return payload;
}

function prune(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function requiredId(value: Record<string, unknown>, message: string) {
  if (typeof value.id !== "string" || !value.id) throw new Error(message);
  return value.id;
}
