import "server-only";
import { BRAND } from "@/lib/brand";
import { envValue } from "@/lib/env";

/**
 * Phase 4D — central email configuration.
 *
 * Provider is selected via `EMAIL_PROVIDER`
 * (`ses` | `resend` | `postmark` | `none`).
 * In development the default is `none`, which makes `dispatch()` log to
 * stdout and return success without contacting any external service.
 */

export type EmailProvider = "ses" | "resend" | "postmark" | "none";

export interface EmailConfig {
  provider: EmailProvider;
  apiKey: string | null;
  sesRegion: string;
  sesConfigurationSet: string | null;
  sesSnsTopicArn: string | null;
  sesCredentialsConfigured: boolean;
  from: string;
  marketingFrom: string;
  replyTo: string | null;
  /** Internal BCC for every order-related email (per spec — admin copy). */
  orderBcc: string | null;
  /** Inbox addresses parsed from inbound webhook payloads. */
  reclamationsInbox: string;
  commentsInbox: string;
  /** Internal recipient notified when the storefront contact form is submitted. */
  commentsNotificationTo: string;
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
      provider === "ses" ||
      provider === "resend" ||
      provider === "postmark" ||
      provider === "none"
        ? provider
        : "none",
    apiKey:
      provider === "resend"
        ? envValue("RESEND_API_KEY")
        : provider === "postmark"
          ? envValue("POSTMARK_SERVER_TOKEN")
          : null,
    sesRegion:
      envValue("SES_REGION") ?? envValue("AWS_REGION") ?? "eu-central-1",
    sesConfigurationSet: envValue("SES_CONFIGURATION_SET"),
    sesSnsTopicArn: envValue("SES_SNS_TOPIC_ARN"),
    sesCredentialsConfigured: Boolean(
      envValue("AWS_ROLE_ARN") ||
      (envValue("AWS_ACCESS_KEY_ID") && envValue("AWS_SECRET_ACCESS_KEY")) ||
      envValue("AWS_CONTAINER_CREDENTIALS_FULL_URI") ||
      envValue("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"),
    ),
    from:
      envValue("EMAIL_FROM") ??
      `${BRAND.name} <no-reply@svetpovoljnihcena.rs>`,
    marketingFrom:
      envValue("EMAIL_MARKETING_FROM") ??
      envValue("EMAIL_FROM") ??
      `${BRAND.name} <no-reply@svetpovoljnihcena.rs>`,
    replyTo: envValue("EMAIL_REPLY_TO"),
    orderBcc: envValue("EMAIL_ORDER_BCC"),
    reclamationsInbox:
      envValue("EMAIL_RECLAMATIONS_INBOX") ?? "reklamacije@svetpovoljnihcena.rs",
    commentsInbox:
      envValue("EMAIL_COMMENTS_INBOX") ?? "komentar@svetpovoljnihcena.rs",
    commentsNotificationTo:
      envValue("EMAIL_COMMENTS_NOTIFICATION_TO") ??
      "office@svetpovoljnihcena.rs",
    inboundSecret: envValue("EMAIL_INBOUND_SECRET"),
    resendWebhookSecret: envValue("RESEND_WEBHOOK_SECRET"),
    promotionsTopicId: envValue("RESEND_TOPIC_PROMOTIONS_ID"),
    newsletterSegmentId: envValue("RESEND_SEGMENT_NEWSLETTER_ID"),
    unsubscribeSecret:
      envValue("EMAIL_UNSUBSCRIBE_SECRET") ??
      envValue("AUTH_SECRET") ??
      envValue("NEXTAUTH_SECRET") ??
      (process.env.NODE_ENV === "development"
        ? "development-only-email-unsubscribe-secret"
        : null),
    alertsCronSecret:
      envValue("EMAIL_ALERTS_CRON_SECRET") ?? envValue("CRON_SECRET"),
    baseUrl:
      envValue("NEXT_PUBLIC_BASE_URL") ??
      envValue("NEXTAUTH_URL") ??
      "https://www.svetpovoljnihcena.rs",
  };
  return cached;
}

/** Test-only: reset the cached config so env changes are picked up. */
export function __resetEmailConfig() {
  cached = null;
}
