import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { redactText } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyInboundMessage,
  handleInboundMessage,
  normalizeInbound,
  type InboundAttachmentMetadata,
} from "./inbound";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "SvetPovoljnihCena-Receiving/1.0";
const DEFAULT_BUCKET = "reclamation-uploads";
const STORAGE_PREFIX = "inbound-email";
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENTS: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

export interface StoredInboundAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  key: string;
}

export interface InboundAttachmentLink extends StoredInboundAttachment {
  signedUrl: string | null;
}

interface SkippedInboundAttachment {
  id: string;
  filename: string;
  reason: string;
}

interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  received_for?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  message_id?: string | null;
  attachments?: unknown;
}

export async function processResendInboundEmail(input: {
  emailId: string;
  eventId: string;
}) {
  await updateProcessing(input.eventId, {
    status: "PROCESSING",
    emailId: input.emailId,
    updatedAt: new Date().toISOString(),
  });

  try {
    const received = await retrieveReceivedEmail(input.emailId);
    const message = normalizeInbound({ ...received, id: input.emailId });
    if (!message) throw new Error("resend_inbound_unrecognized_payload");
    message.messageId = input.emailId;

    const route = classifyInboundMessage(message);
    if (!route) {
      const result = await handleInboundMessage(message);
      await updateProcessing(input.eventId, {
        status: "IGNORED",
        emailId: input.emailId,
        reason: result.ok ? "no_match" : result.reason,
        updatedAt: new Date().toISOString(),
      });
      return result;
    }

    const storedResult = await storeInboundAttachments(
      input.emailId,
      message.attachments,
    );
    message.attachments = storedResult.stored.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      contentDisposition: "attachment",
      size: attachment.size,
    }));
    const result = await handleInboundMessage(message);
    await updateProcessing(input.eventId, {
      status: result.ok ? "PROCESSED" : "IGNORED",
      emailId: input.emailId,
      route: result.ok ? result.route : route,
      commentId: result.ok ? result.commentId : null,
      reason: result.ok ? null : result.reason,
      attachments: storedResult.stored,
      skippedAttachments: storedResult.skipped,
      updatedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    await updateProcessing(input.eventId, {
      status: "FAILED",
      emailId: input.emailId,
      error: safeError(error),
      updatedAt: new Date().toISOString(),
    }).catch((updateError) => {
      console.error("[email] inbound processing status update failed", updateError);
    });
    throw error;
  }
}

export async function retrieveReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const body = await resendJson(
    `/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
  );
  if (!isRecord(body) || typeof body.id !== "string" || typeof body.from !== "string") {
    throw new Error("resend_inbound_invalid_response");
  }
  return body as unknown as ReceivedEmail;
}

export async function loadInboundAttachmentLinks(emailIds: string[]) {
  const uniqueIds = [...new Set(emailIds.filter(Boolean))];
  const result = new Map<string, InboundAttachmentLink[]>();
  if (!uniqueIds.length) return result;

  const events = await db.emailProviderEvent.findMany({
    where: {
      provider: "resend",
      type: "email.received",
      providerMessageId: { in: uniqueIds },
    },
    orderBy: { receivedAt: "desc" },
    select: { providerMessageId: true, payload: true },
  });
  const attachmentsByEmail = new Map<string, StoredInboundAttachment[]>();
  for (const event of events) {
    const emailId = event.providerMessageId;
    if (!emailId || attachmentsByEmail.has(emailId)) continue;
    const attachments = processingAttachments(event.payload);
    if (attachments.length) attachmentsByEmail.set(emailId, attachments);
  }
  const keys = [...new Set([...attachmentsByEmail.values()].flatMap((items) => items.map((item) => item.key)))];
  const signedByKey = await signAttachmentKeys(keys);
  for (const [emailId, attachments] of attachmentsByEmail) {
    result.set(
      emailId,
      attachments.map((attachment) => ({
        ...attachment,
        signedUrl: signedByKey.get(attachment.key) ?? null,
      })),
    );
  }
  return result;
}

export async function removeInboundAttachments(emailId: string) {
  const events = await db.emailProviderEvent.findMany({
    where: {
      provider: "resend",
      type: "email.received",
      providerMessageId: emailId,
    },
    select: { payload: true },
  });
  const keys = [...new Set(events.flatMap((event) => processingAttachments(event.payload).map((item) => item.key)))];
  if (!keys.length) return;
  const { error } = await createAdminClient().storage.from(inboundBucket()).remove(keys);
  if (error) throw new Error(`inbound_attachment_remove_failed:${error.message}`);
}

export function inboundEmailIdFromSubject(subject: string | null | undefined) {
  return subject?.match(/^\[in:([^\]]{1,200})\]/)?.[1] ?? null;
}

async function storeInboundAttachments(
  emailId: string,
  attachments: InboundAttachmentMetadata[],
) {
  const stored: StoredInboundAttachment[] = [];
  const skipped: SkippedInboundAttachment[] = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (stored.length >= MAX_ATTACHMENTS) {
      skipped.push(skip(attachment, "attachment_count_limit"));
      continue;
    }
    const allowedExtensions = ALLOWED_ATTACHMENTS[attachment.contentType];
    const extension = fileExtension(attachment.filename);
    if (!allowedExtensions || !extension || !allowedExtensions.includes(extension)) {
      skipped.push(skip(attachment, "unsupported_type"));
      continue;
    }
    if (attachment.size !== null && attachment.size > MAX_ATTACHMENT_BYTES) {
      skipped.push(skip(attachment, "attachment_too_large"));
      continue;
    }
    if (
      attachment.size !== null &&
      totalBytes + attachment.size > MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      skipped.push(skip(attachment, "total_size_limit"));
      continue;
    }

    const details = await retrieveAttachment(emailId, attachment.id);
    if (details.content_type !== attachment.contentType) {
      throw new Error("resend_inbound_attachment_type_mismatch");
    }
    if (
      !Number.isSafeInteger(details.size) ||
      details.size <= 0 ||
      details.size > MAX_ATTACHMENT_BYTES ||
      totalBytes + details.size > MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      skipped.push(skip(attachment, "attachment_size_limit"));
      continue;
    }
    const bytes = await downloadAttachment(details.download_url, details.size);
    if (!matchesMagic(bytes, attachment.contentType)) {
      throw new Error("resend_inbound_attachment_content_mismatch");
    }
    const key = inboundAttachmentKey(emailId, attachment.id, attachment.filename);
    const { error } = await createAdminClient()
      .storage.from(inboundBucket())
      .upload(key, bytes, {
        contentType: attachment.contentType,
        cacheControl: "3600",
        upsert: true,
      });
    if (error) throw new Error(`inbound_attachment_upload_failed:${error.message}`);
    totalBytes += bytes.byteLength;
    stored.push({
      id: attachment.id,
      filename: attachment.filename.slice(0, 255),
      contentType: attachment.contentType,
      size: bytes.byteLength,
      key,
    });
  }
  return { stored, skipped };
}

async function retrieveAttachment(emailId: string, attachmentId: string) {
  const body = await resendJson(
    `/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (
    !isRecord(body) ||
    typeof body.download_url !== "string" ||
    typeof body.content_type !== "string" ||
    typeof body.size !== "number"
  ) {
    throw new Error("resend_inbound_attachment_invalid_response");
  }
  return body as {
    download_url: string;
    content_type: string;
    size: number;
  };
}

async function downloadAttachment(downloadUrl: string, expectedBytes: number) {
  const url = new URL(downloadUrl);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "inbound-cdn.resend.com" && !url.hostname.endsWith(".resend.com"))
  ) {
    throw new Error("resend_inbound_untrusted_attachment_url");
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  const finalUrl = new URL(response.url || downloadUrl);
  if (
    finalUrl.protocol !== "https:" ||
    (finalUrl.hostname !== "inbound-cdn.resend.com" &&
      !finalUrl.hostname.endsWith(".resend.com"))
  ) {
    throw new Error("resend_inbound_untrusted_attachment_redirect");
  }
  if (!response.ok) {
    throw new Error(`resend_inbound_attachment_download:${response.status}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
    throw new Error("resend_inbound_attachment_too_large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > MAX_ATTACHMENT_BYTES ||
    bytes.byteLength !== expectedBytes
  ) {
    throw new Error("resend_inbound_attachment_size_mismatch");
  }
  return bytes;
}

async function resendJson(path: string) {
  const apiKey = envValue("RESEND_API_KEY");
  if (!apiKey) throw new Error("resend_inbound_not_configured");
  const response = await fetch(`${RESEND_API}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : raw.slice(0, 300);
    throw new Error(`resend_inbound_api:${response.status}:${message}`);
  }
  return body;
}

async function updateProcessing(eventId: string, processing: Record<string, unknown>) {
  const event = await db.emailProviderEvent.findUnique({
    where: { provider_eventId: { provider: "resend", eventId } },
    select: { id: true, payload: true },
  });
  if (!event) return;
  const payload = isRecord(event.payload) ? event.payload : { original: event.payload };
  await db.emailProviderEvent.update({
    where: { id: event.id },
    data: {
      payload: {
        ...payload,
        inboundProcessing: processing,
      } as Prisma.InputJsonValue,
    },
  });
}

async function signAttachmentKeys(keys: string[]) {
  const signed = new Map<string, string>();
  const safeKeys = keys.filter(isInboundAttachmentKey);
  if (!safeKeys.length || !envValue("NEXT_PUBLIC_SUPABASE_URL") || !envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    return signed;
  }
  const { data, error } = await createAdminClient()
    .storage.from(inboundBucket())
    .createSignedUrls(safeKeys, 15 * 60, { download: true });
  if (error || !data) {
    console.error("[email] inbound attachment signing failed", error);
    return signed;
  }
  for (const item of data) {
    if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return signed;
}

function processingAttachments(payload: Prisma.JsonValue) {
  if (!isRecord(payload) || !isRecord(payload.inboundProcessing)) return [];
  const attachments = payload.inboundProcessing.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((item): StoredInboundAttachment[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.filename !== "string" ||
      typeof item.contentType !== "string" ||
      typeof item.size !== "number" ||
      typeof item.key !== "string" ||
      !isInboundAttachmentKey(item.key)
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        filename: item.filename,
        contentType: item.contentType,
        size: item.size,
        key: item.key,
      },
    ];
  });
}

function inboundAttachmentKey(emailId: string, attachmentId: string, filename: string) {
  return [
    STORAGE_PREFIX,
    safeSegment(emailId),
    safeSegment(attachmentId),
    safeFilename(filename),
  ].join("/");
}

function isInboundAttachmentKey(key: string) {
  const parts = key.split("/");
  return (
    parts.length === 4 &&
    parts[0] === STORAGE_PREFIX &&
    parts.slice(1).every((part) => Boolean(part) && !part.includes(".."))
  );
}

function inboundBucket() {
  return (
    envValue("SUPABASE_RECLAMATION_UPLOAD_BUCKET") ??
    envValue("NEXT_PUBLIC_SUPABASE_RECLAMATION_UPLOAD_BUCKET") ??
    DEFAULT_BUCKET
  );
}

function skip(attachment: InboundAttachmentMetadata, reason: string) {
  return { id: attachment.id, filename: attachment.filename.slice(0, 255), reason };
}

function fileExtension(filename: string) {
  return filename.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? null;
}

function safeFilename(filename: string) {
  const extension = fileExtension(filename) ?? "bin";
  const base = filename
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "attachment"}.${extension}`;
}

function safeSegment(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "unknown"
  );
}

function matchesMagic(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (contentType === "image/webp") {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (contentType === "application/pdf") {
    return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message.replace(/[\r\n\t]+/g, " ")).slice(0, 1000);
}
