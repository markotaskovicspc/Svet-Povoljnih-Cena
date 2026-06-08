import "server-only";

import { Prisma, type EmailMessageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getEmailConfig, type EmailProvider } from "./config";
import {
  dispatch,
  type DispatchInput,
  type DispatchResult,
} from "./transport";

type ProviderName = DispatchResult["provider"];

const SKIP_DUPLICATE_STATUSES = new Set<EmailMessageStatus>([
  "SENT",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "BOUNCED",
  "COMPLAINED",
]);

export interface TrackedDispatchInput extends DispatchInput {
  kind: string;
  metadata?: Prisma.InputJsonValue;
}

export async function trackedDispatch(
  input: TrackedDispatchInput,
): Promise<DispatchResult> {
  const cfg = getEmailConfig();
  const { kind, metadata, ...dispatchInput } = input;
  const recipient = recipientsToString(input.to);
  let messageId: string | null = null;

  try {
    if (input.idempotencyKey) {
      const existing = await db.emailMessage.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (
        existing?.providerMessageId &&
        SKIP_DUPLICATE_STATUSES.has(existing.status)
      ) {
        return {
          ok: true,
          id: existing.providerMessageId,
          provider: normalizeProvider(existing.provider, cfg.provider),
        };
      }
    }

    const data = {
      kind,
      recipient,
      subject: input.subject,
      provider: cfg.provider,
      idempotencyKey: input.idempotencyKey ?? null,
      status: "QUEUED" as const,
      tags: input.tags ? (input.tags as Prisma.InputJsonValue) : undefined,
      metadata,
    };

    const message = input.idempotencyKey
      ? await db.emailMessage.upsert({
          where: { idempotencyKey: input.idempotencyKey },
          create: data,
          update: {
            kind,
            recipient,
            subject: input.subject,
            provider: cfg.provider,
            tags: input.tags ? (input.tags as Prisma.InputJsonValue) : undefined,
            metadata,
            status: "QUEUED",
            error: null,
          },
          select: { id: true },
        })
      : await db.emailMessage.create({
          data,
          select: { id: true },
        });
    messageId = message.id;
  } catch (err) {
    console.error("[email] tracking queued failed", err);
  }

  const result = await dispatch(dispatchInput);

  if (messageId) {
    try {
      await db.emailMessage.update({
        where: { id: messageId },
        data: result.ok
          ? {
              provider: result.provider,
              providerMessageId: result.id,
              status: "SENT",
              sentAt: new Date(),
              error: null,
            }
          : {
              provider: result.provider,
              status: "FAILED",
              error: result.error,
            },
      });
    } catch (err) {
      console.error("[email] tracking result failed", err);
    }
  }

  return result;
}

export interface ProviderEventInput {
  provider: "resend" | "postmark";
  eventId: string;
  type: string;
  payload: Prisma.InputJsonValue;
  providerMessageId?: string | null;
}

export async function recordProviderEvent(input: ProviderEventInput) {
  const message = input.providerMessageId
    ? await db.emailMessage.findUnique({
        where: { providerMessageId: input.providerMessageId },
        select: { id: true },
      })
    : null;

  try {
    await db.emailProviderEvent.create({
      data: {
        provider: input.provider,
        eventId: input.eventId,
        type: input.type,
        providerMessageId: input.providerMessageId ?? null,
        messageId: message?.id ?? null,
        payload: input.payload,
      },
    });
  } catch (err) {
    if (isUniqueConstraint(err)) {
      return { ok: true as const, duplicate: true as const };
    }
    throw err;
  }

  const status = statusForProviderEvent(input.type);
  if (message && status) {
    await db.emailMessage.update({
      where: { id: message.id },
      data: { status },
    });
  }

  if (isSuppressingEvent(input.type)) {
    const email = extractRecipient(input.payload);
    if (email) {
      await db.emailSuppression.upsert({
        where: { email },
        create: {
          email,
          reason: input.type,
          provider: input.provider,
          providerEventId: input.eventId,
        },
        update: {
          reason: input.type,
          provider: input.provider,
          providerEventId: input.eventId,
        },
      });
    }
  }

  return { ok: true as const, duplicate: false as const };
}

export async function isEmailSuppressed(email: string) {
  const record = await db.emailSuppression.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  return Boolean(record);
}

function recipientsToString(to: string | string[]) {
  return (Array.isArray(to) ? to : [to])
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

function normalizeProvider(provider: string, fallback: EmailProvider): ProviderName {
  if (provider === "resend" || provider === "postmark" || provider === "none") {
    return provider;
  }
  return fallback;
}

function statusForProviderEvent(type: string): EmailMessageStatus | null {
  switch (type) {
    case "email.sent":
      return "SENT";
    case "email.delivered":
      return "DELIVERED";
    case "email.opened":
      return "OPENED";
    case "email.clicked":
      return "CLICKED";
    case "email.bounced":
      return "BOUNCED";
    case "email.complained":
      return "COMPLAINED";
    case "email.failed":
    case "email.suppressed":
      return "FAILED";
    default:
      return null;
  }
}

function isSuppressingEvent(type: string) {
  return (
    type === "email.bounced" ||
    type === "email.complained" ||
    type === "email.suppressed"
  );
}

function extractRecipient(payload: Prisma.InputJsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const to = (data as Record<string, unknown>).to;
  const email = Array.isArray(to) ? to[0] : to;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

function isUniqueConstraint(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
