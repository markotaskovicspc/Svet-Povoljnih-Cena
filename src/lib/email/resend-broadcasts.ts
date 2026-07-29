import "server-only";

import { getEmailConfig } from "./config";

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
) {
  const cfg = getEmailConfig();
  if (cfg.provider !== "resend" || !cfg.apiKey) {
    throw new Error("Resend nije konfigurisan.");
  }
  const response = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(prune(body)) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
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
