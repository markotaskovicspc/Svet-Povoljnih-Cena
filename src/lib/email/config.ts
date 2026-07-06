import "server-only";
import { BRAND } from "@/lib/brand";
import { envValue } from "@/lib/env";

/**
 * Phase 4D — central email configuration.
 *
 * Provider is selected via `EMAIL_PROVIDER` (`resend` | `postmark` | `none`).
 * In development the default is `none`, which makes `dispatch()` log to
 * stdout and return success without contacting any external service.
 */

export type EmailProvider = "resend" | "postmark" | "none";

export interface EmailConfig {
  provider: EmailProvider;
  apiKey: string | null;
  from: string;
  marketingFrom: string;
  replyTo: string | null;
  /** Internal BCC for every order-related email (per spec — admin copy). */
  orderBcc: string | null;
  /** Inbox addresses parsed from inbound webhook payloads. */
  reclamationsInbox: string;
  commentsInbox: string;
  /** Shared secret for the inbound webhook (`x-webhook-secret` header). */
  inboundSecret: string | null;
  /** Resend webhook signing secret (`svix-*` headers over the raw body). */
  resendWebhookSecret: string | null;
  /** Optional Resend topic / segment IDs for contact sync. */
  promotionsTopicId: string | null;
  newsletterSegmentId: string | null;
  /** HMAC secret for unsubscribe/manage-alert links. */
  unsubscribeSecret: string | null;
  /** Shared secret for the email-alert cron endpoint. */
  alertsCronSecret: string | null;
  baseUrl: string;
}

let cached: EmailConfig | null = null;

export function getEmailConfig(): EmailConfig {
  if (cached) return cached;
  const provider = ((process.env.EMAIL_PROVIDER ?? "none").toLowerCase() ||
    "none") as EmailProvider;
  cached = {
    provider:
      provider === "resend" || provider === "postmark" || provider === "none"
        ? provider
        : "none",
    apiKey:
      provider === "resend"
        ? envValue("RESEND_API_KEY")
        : provider === "postmark"
          ? envValue("POSTMARK_SERVER_TOKEN")
          : null,
    from:
      process.env.EMAIL_FROM ??
      `${BRAND.name} <no-reply@svetpovoljnihcena.rs>`,
    marketingFrom:
      process.env.EMAIL_MARKETING_FROM ??
      process.env.EMAIL_FROM ??
      `${BRAND.name} <no-reply@svetpovoljnihcena.rs>`,
    replyTo: process.env.EMAIL_REPLY_TO ?? null,
    orderBcc: process.env.EMAIL_ORDER_BCC ?? null,
    reclamationsInbox:
      process.env.EMAIL_RECLAMATIONS_INBOX ?? "reklamacije@svetpovoljnihcena.rs",
    commentsInbox:
      process.env.EMAIL_COMMENTS_INBOX ?? "komentar@svetpovoljnihcena.rs",
    inboundSecret: process.env.EMAIL_INBOUND_SECRET ?? null,
    resendWebhookSecret: envValue("RESEND_WEBHOOK_SECRET"),
    promotionsTopicId: envValue("RESEND_TOPIC_PROMOTIONS_ID"),
    newsletterSegmentId: envValue("RESEND_SEGMENT_NEWSLETTER_ID"),
    unsubscribeSecret:
      process.env.EMAIL_UNSUBSCRIBE_SECRET ??
      process.env.AUTH_SECRET ??
      process.env.NEXTAUTH_SECRET ??
      (process.env.NODE_ENV === "development"
        ? "development-only-email-unsubscribe-secret"
        : null),
    alertsCronSecret:
      process.env.EMAIL_ALERTS_CRON_SECRET ?? process.env.CRON_SECRET ?? null,
    baseUrl:
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      "https://www.svetpovoljnihcena.rs",
  };
  return cached;
}

/** Test-only: reset the cached config so env changes are picked up. */
export function __resetEmailConfig() {
  cached = null;
}
