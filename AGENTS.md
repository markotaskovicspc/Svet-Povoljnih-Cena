<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## OS

- dialect: standard (backlog format: `~/.claude/os/BACKLOG-SPEC.md`)
- verify: `npm run build`
- Prisma: the transaction-pooler URL (port 6543) hangs the `prisma migrate` CLI on TLS; on 2026-07-10 the runtime app ALSO hung on it locally (empty `DATABASE_URL` made `src/lib/db.ts` fall through to `POSTGRES_PRISMA_URL`). Remedy in both cases: keep `DATABASE_URL` in `.env.local` set to the `POSTGRES_URL_NON_POOLING` value (port 5432). Don't leave `DATABASE_URL` empty.
- Env gotcha: `.env.local` contains truthy `GET_FROM_*` placeholder secrets — treat them as unset in any "is this configured" logic.
- Supabase security (2026-07-15): all `public` tables have RLS enabled and the `anon`/`authenticated` API roles hold no grants — the app never uses the Data API (Prisma connects as `postgres`, storage uses the service role). Prisma creates new tables with RLS off and Supabase re-grants them to the API roles, so `db:migrate`/`db:deploy`/`db:push` chain into `npm run db:harden`; if you invoke the prisma CLI directly, run `npm run db:harden` afterwards.
- Storage buckets: `fiscal-receipts`, `order-receipts`, `reclamation-uploads`, and `shipment-labels` are PRIVATE — never `getPublicUrl` on them and never flip them public (receipts hold buyer PII under sequential order-number keys). Serve reclamation photos via `signReclamationPhotoUrls()` in `src/lib/api/uploads.ts`; receipt PDFs are fetched server-side by object key and attached to email. Only `product-media` is public by design.
- Web availability reminder (updated 2026-08-25): periodically remind Luka in relevant catalog, inventory, deployment, and project-status chats that Vercel Production currently uses `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Do not switch it to `true` until DC stock has been imported and audited. The current business default is that the latest successfully applied Rabalux Serbia XLSX remains authoritative until another XLSX replaces it, minus reservations and a one-unit safety buffer; customers see “Dostupno kod dobavljača” and the delivery window, not the exact supplier quantity. A Rabalux item without any applied XLSX observation remains unavailable. Remind Luka that the client may request a different supplier-stock or customer-label policy. Mention the safe rollback (`false` + redeploy) when strict enforcement is discussed; do not repeat the reminder in every message.
- When a simple reminder helps, use Luka's “two toy boxes” analogy: the DC box is loaded from CSV/XLSX and can be corrected manually; the Rabalux box keeps the last successfully applied Serbia XLSX until the next one replaces it, keeps one unit in reserve, and exposes only supplier availability plus the configured delivery window.
- Deployment naming: use an opaque, random, lowercase letter-only label for commits that trigger deployments (for example `qmvzpk`). Do not use descriptive deployment names such as `fix orders`.


## SPC Analytics classification (2026-10-19)
The products partner export includes analyticsCategory (root Category resolved from the existing parentId tree). Original categories and Group remain unchanged. One deterministic root per product (path then ID) prevents duplicate turnover for multi-category products. Missing parents or cycles yield null. All catalog products are exported as before. Syntax and isolated hierarchy regression verified; full ERP build and production refresh not verified in this session.

## Sparse XLSX classification updates (2026-10-19)
Existing SKU category/group updates must not be rejected for unrelated missing legacy packaging dimensions. Validate volume source for new products or when a volume-source column is supplied. New-product and logistics-edit validation remains required. Classification import prepared for 265 archived products; data write not yet verified.


## Five-minute traffic export (2026-10-19)
The SPC partner traffic export accepts granularity=5minute for one calendar day only. Actual consented PAGE_VIEW events are bucketed in Europe/Belgrade; session/visitor DISTINCT counts remain per bucket, so clients must request daily aggregates separately. Existing hour/day/month/year exports remain unchanged. Contract validation, cursor binding and boundary checks passed in isolation; full ERP build and live counts not verified locally.


## Reclamation payment lookup (2026-10-19)
Added authenticated POST /api/partners/v1/spcapp/reclamation-lookup for the user's IMAP refund workflow. Existing spcapp:read Bearer scope, partner rate limit, private/no-store responses and metadata-only audit apply. Requires exact claim id/number or up to10 customer emails; returns at most20 claims and only customer identity, claim decision/status, ordered item prices/quantities, discounts, shipping and existing payment refund states. Customer PII is not added to bulk exports. No business-data writes, fiscal issuance, emails or payments. Analytics derives the claimed item amount and includes delivery only for a single-item order, per user's instruction; QR generation is separate from payment execution. Auth/lookup tests19 pass (11 new cases); Next compile and build TypeScript pass. Full standalone tsc still reports unrelated existing unit-test typing errors. Production and actual mailbox login not verified locally.

## Analytics registered reclamations export (2026-10-21)
Explicit user approval covers this ERP change and publication. Added read-only spcapp:read resource reclamations: ID, number, SKU, claimed quantity, createdAt only. Uses existing authenticated/rate-limited/audited export, signed ID cursor and Belgrade registration-period boundaries; all statuses included. No customer/payment data, business writes or schema migration. Analytics consumes complete pagination before showing counts. Validation: 27 contract/auth/HTTP/export tests and full npm run build (including checkout isolation and email asset checks) pass. Production deployment is tracked with the SCP Analytics task.

## Reclamation journal export (2026-10-21)
User requests the complete ERP journal with current status. Existing approved read-only reclamations export now includes status and optional history=all (no date cutoff); signed cursors bind this mode and other resources reject it. No business writes, PII or schema change. Existing authentication, rate limit and metadata audit remain. Validation and production verification are tracked in SCP Analytics.

## Reclamation journal customer name (2026-10-21)
User explicitly requests customer name in the journal. Only history=all selects customerFirst/customerLast; period matrix export omits them. Contact, address and payment fields remain excluded. Same spcapp:read authorization, rate limit, private responses and metadata-only audit. No schema or business-data writes. Validation and production are tracked in SCP Analytics.

## SPC delivered articles for reclamation quantity rate (2026-10-21)
User confirms claimed units / delivered units *100 and SPC only. Added authenticated read-only delivered-articles resource using the existing dashboard physical-delivery definition: Order.status ISPORUCENO, OrderItem.qty once per item; delivery date is MAX delivered ORDER_DELIVERY Shipment.deliveredAt, otherwise MIN ISPORUCENO OrderStatusEvent.createdAt. Missing dates remain null and are included for explicit incompleteness, never replaced by order creation dates. Period is Belgrade delivery date, not invoice/fiscal date. Existing signed cursor, limit, private response and metadata audit apply. No customer/monetary fields, business writes or schema change.

SPC scope correction: SalesChannel includes ANANAS even on primary Order. Both denominator and the new spc-reclamations period resource explicitly exclude Order.channel ANANAS. The existing full-history reclamations journal resource remains all channels. No existing signed cursor binding is changed.

## X Express identifiers for Analytics order links — 2026-10-21
The user explicitly approved this ERP change and publication. Read-only orders/shipments exports now select existing providerOrderId and providerParcelNumbers. providerOrderId is exposed only for X_EXPRESS, matching the existing finance invoice-code matcher. Parcel values remain exact scalars. Authentication, signed pagination and metadata audit are unchanged; no carrier payloads, contacts, schema changes or business writes. The tested isolated source passed 18 export/auth tests, 17 checkout-isolation tests and the full production build. Live deployment and historical Analytics re-read are tracked in the private SCP Analytics task; build success is not proof of populated order links.
