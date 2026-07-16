# Production runbook

This document separates deployable application work from provider and business approvals. A production flag must never be enabled merely because credentials are present.

## Release gate

Before each release:

1. CI must pass lint, unit tests, build, newsletter E2E, and the `SUPER`, `CONTENT`, `OPS`, and `ADS` access matrix.
2. Run `npm audit --omit=dev --audit-level=moderate`; there must be no production vulnerability at or above the threshold.
3. Run `npm run check:production-env` against the hosting production environment. It reports variable names/status only and never prints secret values.
4. Review the migration SQL. Deploy with the non-pooling PostgreSQL URL on port 5432: `DATABASE_URL=$POSTGRES_URL_NON_POOLING npm run db:deploy`. The command also reapplies RLS and revokes Data API roles.
5. Deploy the application before enabling new provider acceptance flags.
6. Verify `/api/health`, `/robots.txt`, `/sitemap.xml`, login, registration, password reset, account export/deletion, checkout, and the admin authorization matrix.
7. Inspect `BackgroundJob` for `FAILED` or stale `RUNNING` rows. The `/api/cron/background-jobs` schedule and `CRON_SECRET` must be active.

## Provider acceptance gates

| Capability | Keep disabled until | External owner action |
| --- | --- | --- |
| Resend | Domain, SPF/DKIM and webhook are verified; delivered/bounce/complaint tests pass | Domain owner / email administrator |
| IPS | Public HTTPS success/fail/cancel/callback URLs are installed; payment, status reconciliation and refund pass | Bank/IPS contact and business owner |
| RaiAccept/cards/wallets | Signed callback and real acceptance suite pass | Bank/acquirer |
| MyGLS | Pickup identity/contact is complete and a tagged create/label/status/COD/delete test passes | Warehouse lead / MyGLS |
| X Express | Portal confirms address-check and order payloads; tagged address/create/status test passes | X Express technical contact |
| BADI | Valid sandbox credentials and VPFR settings pass sale, duplicate retry and refund | Fiscal provider / accountant |
| Viber | Contract, sender and webhook are approved; duplicate delivery reports pass | Viber partner |

Provider methods remain hidden by the `*_PRODUCTION_ACCEPTED` flags. Never work around these flags in the database or UI.

## Backups and restore

- Enable managed daily backups and point-in-time recovery on the production PostgreSQL project before accepting orders.
- Enable object versioning or a provider backup policy for the private receipt, reclamation and label buckets.
- Once per quarter, restore the latest database backup into an isolated project, run migrations, verify order/payment/refund/fiscal counts, and download one object from every private bucket with a server-side client.
- Record recovery point, recovery time, operator, restored counts, and any discrepancy. A backup is not considered verified until this restore drill succeeds.
- Never restore a production backup into a public preview environment or one with outbound email/provider credentials enabled.

## Monitoring and incident response

- Uptime monitoring: check `/api/health` at least every five minutes from two regions.
- Alert on HTTP 5xx rate, cron failures, failed background jobs, payment callbacks without reconciliation, email bounce/complaint spikes, stale shipment status, fiscal `FAILED` documents, and database/storage capacity.
- Application errors are emitted as structured, redacted logs through Next.js instrumentation. Configure the hosting log drain/error platform and retention before launch.
- On a payment ambiguity, do not submit a second refund. `PaymentRefund.NEEDS_REVIEW` reserves the amount until an operator reconciles it with IPS.
- On provider outage, keep the affected acceptance flag disabled, preserve queued jobs, and communicate the affected order numbers without copying buyer PII into chat or tickets.

## Rollback

1. Disable the affected provider flag first if the incident is integration-specific.
2. Roll back the application deployment through the hosting platform.
3. Do not automatically roll back a database migration after it has accepted writes. Use a reviewed forward migration.
4. Confirm health, authentication, checkout visibility, cron processing and provider callbacks on the restored deployment.

## Full sale acceptance record

The unrestricted launch remains blocked until one tagged, owner-approved production transaction proves this sequence and is reconciled on every system: order → payment or COD → stock reservation → supplier reservation → shipment/label → pickup fiscal receipt → email → delivery status → return/refund → stock and fiscal/payment reconciliation. Record provider IDs, timestamps and expected totals, then remove only disposable fixtures; never rewrite financial sequences.
