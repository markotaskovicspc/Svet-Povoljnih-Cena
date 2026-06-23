# Resend Email Plan

## Goal

Use Resend as the main email system for customer account flows, order and receipt emails, marketing, back-in-stock alerts, sale alerts, and useful ERP/admin notifications.

The project already has a provider-based email module with Resend support, so the work should build on that instead of replacing it. The missing pieces are account verification, delivery tracking, marketing/contact sync, product alert sending, and a broader set of operational/admin emails.

## Current Starting Point

- Existing email config already supports `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, sender/reply-to settings, BCCs, and inbound email secret.
- Existing transport already sends through Resend's REST API.
- Existing templates/senders cover order confirmation, order status, fiscal receipt, reclamation receipt, password reset, OTP, and magic links.
- Registration currently creates the user and signs them in immediately, but does not verify email.
- Password reset exists, but token generation should be hardened.
- Newsletter subscribers and marketing consent are stored locally, but are not synced to Resend Contacts/Audiences yet.
- Wishlist alert tables exist for back-in-stock and on-sale alerts, but no scheduled sender currently processes them.
- Admin order/reclamation status changes are persisted, but not consistently emailed to customers.
- The ERP document suggests additional email opportunities around supplier purchase orders, Ananas syncs, finance reports, stock issues, campaign updates, and voucher/promo workflows.

## Decisions

- Account verification should be non-blocking: users can register and sign in, but they get a confirmation email and reminders until verified.
- Marketing should use Resend Broadcasts for now.
- Later, the admin panel can grow into a campaign composer that prepares and manages Resend Broadcast content from products, categories, vouchers, banners, and campaign data.
- Transactional emails should stay app-driven through the email API, not Broadcasts.
- Product alerts should stay app-driven because they are per-user/per-product triggered messages.

## Implementation Plan

### 1. Account Email Verification

Add a customer email confirmation flow:

- Add `sendEmailConfirmation`.
- Generate verification tokens using `randomBytes(32).toString("base64url")`.
- Store tokens in the existing `VerificationToken` table with an identifier like `email-confirm:<userId>`.
- Use a 24-hour expiry.
- Add `GET /nalog/email/potvrdi?token=...` to verify and set `User.emailVerified`.
- Add `POST /api/auth/email-verification/resend` so logged-in users can request a new confirmation email.
- Keep registration sign-in behavior, but show a reminder/banner until email is verified.
- Fetch fresh `emailVerified` state on account/checkout pages instead of relying only on the session.

### 2. Harden Transactional Sending

Keep the existing email abstraction, but add durable tracking:

- Add `EmailMessage` for sent message metadata, status, provider IDs, idempotency keys, tags, and errors.
- Add `EmailProviderEvent` for Resend webhook events with deduplication by provider event ID.
- Log each app-triggered email before or after dispatch.
- Store Resend message IDs when available.
- Use idempotency keys for important transactional emails.
- Keep attachments on individual transactional sends, especially fiscal receipts and invoices.

Suggested `EmailMessage` fields:

- `id`
- `kind`
- `recipient`
- `subject`
- `provider`
- `providerMessageId`
- `idempotencyKey`
- `status`
- `tags`
- `metadata`
- `error`
- `createdAt`
- `sentAt`
- `updatedAt`

Suggested statuses:

- `QUEUED`
- `SENT`
- `DELIVERED`
- `OPENED`
- `CLICKED`
- `BOUNCED`
- `COMPLAINED`
- `FAILED`

Suggested `EmailProviderEvent` fields:

- `id`
- `provider`
- `eventId`
- `type`
- `providerMessageId`
- `messageId`
- `payload`
- `receivedAt`

### 3. Resend Webhooks

Add `POST /api/email/events` for Resend webhooks:

- Verify webhook signature/secret.
- Persist the raw event payload.
- Deduplicate events.
- Update the matching `EmailMessage` status.
- Track bounces, complaints, delivery failures, opens, and clicks.
- Use bounce/complaint events to suppress future marketing sends where appropriate.

### 4. Order, Receipt, and Service Emails

Complete the transactional coverage:

- Registration confirmation.
- Password reset.
- Magic link/OTP if used.
- Order confirmation.
- Order status changes from admin.
- Courier status changes.
- Fiscal receipt delivery.
- Fiscal receipt resend from admin.
- Reclamation receipt.
- Reclamation status update from admin.
- Voucher/coupon delivery if vouchers become customer-specific.
- Payment failure/success emails if payment provider events are added.

### 5. Marketing With Resend Broadcasts

Use local consent as the source of truth, then sync to Resend:

- Sync `NewsletterSubscriber` rows to Resend Contacts.
- Sync users with `MarketingConsent.email=true` to Resend Contacts.
- Include useful contact properties such as name, customer ID, consent source, preferred locale, last order date, and segment hints.
- Use Resend Audiences/Topics for newsletter and promotional categories.
- Use Resend Broadcasts for campaign sends for now.
- Keep local unsubscribe and consent update routes, and mirror unsubscribes back to Resend.

Later admin composer:

- Select products/categories/vouchers/campaigns from the admin.
- Generate an email preview.
- Send test email.
- Create/update a Resend Broadcast.
- Track campaign performance through webhook events and Resend analytics.

### 6. Back-In-Stock and Sale Alerts

Build app-driven alert sending:

- Add `sendBackInStockAlert`.
- Add `sendOnSaleAlert`.
- Add `GET/POST /api/cron/email-alerts`.
- Scan unsent `BackInStockAlert` and `OnSaleAlert` rows.
- Send only when product state matches the alert condition.
- Mark alerts with `notifiedAt` after successful sending.
- Include signed unsubscribe/manage-alert links.
- Respect global email marketing/alert consent where applicable.

### 7. Admin and ERP Email Opportunities

From the ERP document, Resend can also support:

- Supplier purchase-order emails with PDF/XLS attachments.
- Stock discrepancy alerts.
- Low-stock internal digests.
- Ananas API sync failure alerts.
- Ananas order/invoice retrieval failure alerts.
- Courier pickup/delivery exception alerts.
- Daily sales report emails.
- Weekly finance/accounting summaries.
- Voucher campaign launch notifications.
- Banner/promo campaign start and end reminders.
- Customer service assignment notifications.
- Internal digest for new reclamations/comments.

Supplier purchase-order emails should wait until the ERP purchase-order tables/workflows exist in the app.

## Environment Variables

Existing variables to keep using:

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=
EMAIL_FROM=
EMAIL_REPLY_TO=
EMAIL_ORDER_BCC=
EMAIL_RECLAMATIONS_INBOX=
EMAIL_COMMENTS_INBOX=
EMAIL_INBOUND_SECRET=
NEXT_PUBLIC_BASE_URL=
NEXTAUTH_URL=
```

New variables to add:

```env
EMAIL_MARKETING_FROM=
RESEND_WEBHOOK_SECRET=
RESEND_TOPIC_PROMOTIONS_ID=
RESEND_SEGMENT_NEWSLETTER_ID=
EMAIL_UNSUBSCRIBE_SECRET=
EMAIL_ALERTS_CRON_SECRET=
```

## New Public Routes

- `GET /nalog/email/potvrdi`
- `POST /api/auth/email-verification/resend`
- `POST /api/email/events`
- `GET /api/email/unsubscribe/[token]`
- `POST /api/email/unsubscribe/[token]`
- `GET /api/cron/email-alerts`
- `POST /api/cron/email-alerts`

## Testing Plan

- Unit test verification token creation, expiry, and consume behavior.
- Unit test password reset token hardening.
- Unit test dispatch logging and idempotency.
- Unit test webhook deduplication and status updates.
- Unit test newsletter/contact sync payloads.
- Unit test back-in-stock and on-sale alert eligibility.
- Route test registration sends confirmation email without blocking sign-in.
- Route test resend-verification endpoint.
- Route test unsubscribe/manage-alert links.
- Smoke test with `EMAIL_PROVIDER=none`.
- Smoke test with Resend sandbox or verified domain.
- Run `npm run lint`.
- Run `npm run build`.

## Resend References

- [Resend Next.js guide](https://resend.com/nextjs)
- [Resend batch sending](https://resend.com/docs/dashboard/emails/batch-sending)
- [Resend audiences](https://resend.com/docs/dashboard/audiences/introduction)
- [Resend topics](https://resend.com/docs/dashboard/topics/introduction)
- [Resend webhooks](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data)
- [Resend attachments](https://resend.com/docs/dashboard/emails/attachments)
