import "server-only";

import { createHash } from "node:crypto";
import {
  SESv2Client,
  SendBulkEmailCommand,
  SendEmailCommand,
  type MessageTag,
} from "@aws-sdk/client-sesv2";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import type { DispatchInput, DispatchResult, EmailAttachment } from "./transport";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_BULK_DESTINATIONS = 50;

type SesClientLike = {
  send(
    command: SendEmailCommand | SendBulkEmailCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
};

export interface SesDispatchConfig {
  region: string;
  configurationSet: string | null;
  from: string;
  replyTo: string | null;
}

export interface SesBulkRecipient {
  email: string;
  templateData: Record<string, string>;
}

export interface SesBulkInput {
  from: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  recipients: SesBulkRecipient[];
  tags?: Record<string, string>;
}

export type SesBulkResult =
  | {
      ok: true;
      results: Array<{
        email: string;
        ok: boolean;
        id: string | null;
        error: string | null;
      }>;
    }
  | { ok: false; error: string };

let clients = new Map<string, SesClientLike>();
let clientOverride: SesClientLike | null = null;

export async function dispatchSes(
  input: DispatchInput,
  config: SesDispatchConfig,
): Promise<DispatchResult> {
  try {
    const output = (await sendWithTimeout(
      clientFor(config.region),
      new SendEmailCommand({
        FromEmailAddress: input.from ?? config.from,
        Destination: {
          ToAddresses: addresses(input.to),
          CcAddresses: optionalAddresses(input.cc),
          BccAddresses: optionalAddresses(input.bcc),
        },
        ReplyToAddresses: optionalAddresses(input.replyTo ?? config.replyTo),
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: input.html, Charset: "UTF-8" },
              ...(input.text
                ? { Text: { Data: input.text, Charset: "UTF-8" } }
                : {}),
            },
            Attachments: sesAttachments(input.attachments),
          },
        },
        EmailTags: sesTags(input.tags, input.idempotencyKey),
        ConfigurationSetName: config.configurationSet ?? undefined,
      }),
    )) as { MessageId?: string };

    if (!output.MessageId) {
      return {
        ok: false,
        error: "ses:unexpected_response missing_message_id",
        provider: "ses",
      };
    }
    return { ok: true, id: output.MessageId, provider: "ses" };
  } catch (error) {
    return { ok: false, error: normalizeSesError(error), provider: "ses" };
  }
}

export async function dispatchSesBulk(
  input: SesBulkInput,
  config: Pick<SesDispatchConfig, "region" | "configurationSet">,
): Promise<SesBulkResult> {
  if (!input.recipients.length || input.recipients.length > MAX_BULK_DESTINATIONS) {
    return {
      ok: false,
      error: `ses:validation bulk_recipient_count_must_be_1_to_${MAX_BULK_DESTINATIONS}`,
    };
  }

  try {
    const output = (await sendWithTimeout(
      clientFor(config.region),
      new SendBulkEmailCommand({
        FromEmailAddress: input.from,
        ReplyToAddresses: optionalAddresses(input.replyTo),
        DefaultContent: {
          Template: {
            TemplateContent: {
              Subject: input.subject,
              Html: input.html,
              Text: input.text,
            },
            TemplateData: "{}",
          },
        },
        BulkEmailEntries: input.recipients.map((recipient) => ({
          Destination: { ToAddresses: [recipient.email] },
          ReplacementEmailContent: {
            ReplacementTemplate: {
              ReplacementTemplateData: JSON.stringify(recipient.templateData),
            },
          },
        })),
        DefaultEmailTags: sesTags(input.tags),
        ConfigurationSetName: config.configurationSet ?? undefined,
      }),
    )) as {
      BulkEmailEntryResults?: Array<{
        Status?: string;
        MessageId?: string;
        Error?: string;
      }>;
    };

    const providerResults = output.BulkEmailEntryResults ?? [];
    if (providerResults.length !== input.recipients.length) {
      return {
        ok: false,
        error: `ses:unexpected_response bulk_result_count_${providerResults.length}`,
      };
    }
    return {
      ok: true,
      results: input.recipients.map((recipient, index) => {
        const result = providerResults[index];
        const accepted = result?.Status === "SUCCESS" && Boolean(result.MessageId);
        return {
          email: recipient.email,
          ok: accepted,
          id: accepted ? result.MessageId ?? null : null,
          error: accepted
            ? null
            : `ses:${result?.Status ?? "FAILED"} ${cleanErrorText(result?.Error)}`.trim(),
        };
      }),
    };
  } catch (error) {
    return { ok: false, error: normalizeSesError(error) };
  }
}

function clientFor(region: string): SesClientLike {
  if (clientOverride) return clientOverride;
  const normalizedRegion = region.trim();
  if (!normalizedRegion) throw new Error("ses:missing_config region");
  const existing = clients.get(normalizedRegion);
  if (existing) return existing;
  const client = new SESv2Client({
    region: normalizedRegion,
    maxAttempts: maxAttempts(),
    ...(process.env.AWS_ROLE_ARN?.trim()
      ? {
          credentials: awsCredentialsProvider({
            roleArn: process.env.AWS_ROLE_ARN.trim(),
          }),
        }
      : {}),
  }) as SesClientLike;
  clients.set(normalizedRegion, client);
  return client;
}

async function sendWithTimeout(
  client: SesClientLike,
  command: SendEmailCommand | SendBulkEmailCommand,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await client.send(command, { abortSignal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function addresses(value: string | string[]) {
  const result = (Array.isArray(value) ? value : [value])
    .map((item) => item.trim())
    .filter(Boolean);
  if (!result.length) throw new Error("ses:validation recipient_required");
  return result;
}

function optionalAddresses(value?: string | string[] | null) {
  if (!value) return undefined;
  const result = addresses(value);
  return result.length ? result : undefined;
}

function sesAttachments(attachments?: EmailAttachment[]) {
  if (!attachments?.length) return undefined;
  let totalBytes = 0;
  return attachments.map((attachment) => {
    const raw = decodeBase64(attachment.content, attachment.filename);
    totalBytes += raw.byteLength;
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      throw new Error("ses:validation attachments_exceed_30mb");
    }
    return {
      RawContent: raw,
      FileName: attachment.filename,
      ContentType: attachment.contentType ?? "application/octet-stream",
      ContentDisposition: "ATTACHMENT" as const,
    };
  });
}

function decodeBase64(value: string, filename: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(`ses:validation invalid_base64_attachment ${filename.slice(0, 120)}`);
  }
  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

function sesTags(tags?: Record<string, string>, idempotencyKey?: string) {
  const rows = Object.entries(tags ?? {})
    .map(([name, value]) => tag(name, value))
    .filter((item): item is MessageTag => Boolean(item));
  if (idempotencyKey) {
    rows.push({
      Name: "idempotency",
      Value: createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 64),
    });
  }
  return rows.length ? rows.slice(0, 50) : undefined;
}

function tag(name: string, value: string): MessageTag | null {
  const safeName = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
  const safeValue = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
  return safeName && safeValue ? { Name: safeName, Value: safeValue } : null;
}

function normalizeSesError(error: unknown) {
  if (error instanceof Error && error.message.startsWith("ses:")) {
    return error.message;
  }
  const record = error && typeof error === "object" ? error as {
    name?: unknown;
    message?: unknown;
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
    $retryable?: unknown;
  } : null;
  const name = typeof record?.name === "string" ? record.name : "unknown_error";
  const message = cleanErrorText(
    typeof record?.message === "string" ? record.message : String(error),
  );
  const status = record?.$metadata?.httpStatusCode;
  const requestId = record?.$metadata?.requestId;
  const retryable = Boolean(record?.$retryable) || [
    "AbortError",
    "TimeoutError",
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailableException",
  ].includes(name);
  return [
    `ses:${name}`,
    `status=${typeof status === "number" ? status : "n/a"}`,
    `requestId=${typeof requestId === "string" ? requestId : "n/a"}`,
    `retryable=${retryable}`,
    `message=${message}`,
  ].join(" ");
}

function cleanErrorText(value: unknown) {
  return String(value ?? "unknown").replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function timeoutMs() {
  const value = Number.parseInt(process.env.SES_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(value)
    ? Math.min(Math.max(value, 5_000), 60_000)
    : DEFAULT_TIMEOUT_MS;
}

function maxAttempts() {
  const value = Number.parseInt(process.env.SES_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 5) : 3;
}

export function __setSesClientForTests(client: SesClientLike | null) {
  clientOverride = client;
  clients = new Map();
}
