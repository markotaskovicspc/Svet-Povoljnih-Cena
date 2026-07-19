# Production Readiness Audit — 2026-07-19

Project: Svet povoljnih cena
Audit date: 2026-07-19 (Europe/Belgrade)
Baseline commit: `f1d7c05` plus the uncommitted QA fixes listed in this report
Decision: **NO-GO — not safe to publish for real orders yet**

## Scope and evidence standard

This audit combined source review, route and role inventory, a production build,
unit and E2E automation, read-only database inspection, authenticated browser
checks, desktop/mobile visual checks, local production-server requests, security
header inspection, an npm advisory check, and production-environment validation.

Confirmed facts are labeled as verified. Provider behavior that needs a real
account, callback, delivery, fiscal device, or destructive write is labeled
unverified. No real order, payment, shipment, fiscal receipt, refund, email
campaign, product mutation, or destructive admin action was created during this
audit. Temporary QA admin accounts were removed after testing.

Browser coverage was Chromium-based desktop and mobile emulation. A second
browser engine, a genuinely cleared HTTP cache, network throttling, production
DNS/SSL, and high-concurrency load testing were not available in this run.

## A. Executive summary

The application is technically substantial and builds successfully. Public
content routes, account protection, admin route protection, the four admin
roles, product-card galleries, security headers, private-storage design, RLS,
cron authorization, webhook verification, and core automated tests are in good
shape. The product-card first-image defect could not be reproduced in the
current code; visible cards showed the ordered first image immediately, a blur
placeholder covered mobile loading, gallery state remained isolated, and
missing/one-image behavior was correct.

The platform must not accept real orders yet:

1. **No active product is purchasable.** All 209 active products fail catalog
   readiness because dimensions are missing. Only SKU `1133` has stock (9), and
   it is correctly blocked by that safety rule.
2. **The production environment gate fails six mandatory checks.** MyGLS lacks
   pickup contact name/phone and approval; X Express lacks approval; BADI lacks
   a fiscal location and approval.
3. **A complete tagged sale has not been proven.** Payment/COD, stock,
   shipment, fiscalization, confirmation email, delivery, return/refund, and
   reconciliation have not been accepted end to end.
4. **Operational evidence is incomplete.** The database contains 14 failed
   email messages, two failed MyGLS shipments, and one failed fiscal record.
   Managed backups, a restore drill, external uptime/error alerts, and production
   log-drain retention were not demonstrated.
5. **Critical admin write workflows were not mutated against the live-like
   database.** Page loads and RBAC were verified, but create/edit/import/export,
   order status, refund, shipment, fiscal, and deletion workflows require an
   isolated staging acceptance pass.

The estimated readiness is **55/100**. The correct launch decision is
**NO-GO**, not because the codebase is generally broken, but because the primary
business flow currently has zero eligible inventory and the external
production/operations gates have not been accepted.

## B. Production readiness score

| Area | Score | Reason |
| --- | ---: | --- |
| Overall | **55** | Strong application foundation; no purchasable catalog and mandatory provider/operations gates remain. |
| Public platform | 72 | Core routes, responsive layouts, metadata, sitemap, robots, fallbacks, and navigation work; homepage/PDP are heavy and client content is incomplete. |
| User flows | 45 | Protected routing and forms exist; the primary cart-to-order flow cannot start because zero products pass readiness. |
| Admin panel | 78 | 31 canonical routes and four-role RBAC verified; write/destructive/provider actions were not safely executed. |
| Payments | 35 | COD cash/card and bank transfer are enabled; electronic methods remain gated and no accepted full transaction/refund exists. |
| Emails | 40 | Provider/webhook/retry code exists and newsletter error UX passes; 14 failed messages exist and real delivery/domain acceptance was not proven. |
| Security | 84 | RLS, revoked API grants, server authorization, signed private files, rate limits, webhook checks, CSP/headers, and zero npm production advisories verified. |
| Performance | 55 | Search improved from ~11.2 s to ~2.1 s; homepage remains ~12.9 s/429 KB and PDP ~4.4 s/273 KB locally. |
| Mobile experience | 80 | Public cards and mobile admin navigation usable with no document-level horizontal overflow; only Chromium emulation was tested. |
| Infrastructure | 55 | Clean production build, health route, Vercel cron manifest, migration and hardening workflow exist; production env gate, deployment, DNS/SSL, backup/restore evidence remain. |
| Monitoring | 38 | Structured redacted logs and a runbook exist; no external error tracker, log drain, uptime alerts, or alert delivery was demonstrated. |
| Legal/content readiness | 48 | Legal routes and consent mechanisms exist; official contact/returns details and legal/business approval are incomplete. |

## Platform inventory and critical flow map

### Architecture

- Next.js 16.2.9, React 19.2.4, TypeScript, Tailwind, Auth.js.
- Prisma 7/PostgreSQL on Supabase; Supabase Storage.
- Resend/Postmark-capable email layer.
- IPS and RaiAccept payment integrations; COD and bank transfer configuration.
- MyGLS, X Express, and bulky-delivery adapter.
- BADI fiscalization.
- Viber campaigns/webhook, Google/Meta/Budget feeds, GA/Meta/TikTok hooks.
- Vercel-style cron schedule plus database-backed background jobs.

### Roles

| Capability | Visitor | Customer | CONTENT | OPS | ADS | SUPER |
| --- | --- | --- | --- | --- | --- | --- |
| Public catalog/account entry | Yes | Yes | Yes | Yes | Yes | Yes |
| Own account/orders | No | Own only | No admin privilege | No admin privilege | No admin privilege | No customer impersonation |
| Content/catalog admin | No | No | Yes | Limited by module | No | Yes |
| Orders/inventory/fulfillment | No | No | No | Yes | No | Yes |
| Ads/feeds/marketing | No | No | Limited content areas | No | Yes | Yes |
| Audit/system-wide admin | No | No | No | No | No | Yes |

Backend enforcement was verified through `requireAdminAction`,
module-specific role mappings, protected API responses, direct URL checks, and
isolated role accounts. Hidden UI is not the security boundary.

### Critical commerce flow

```text
Catalog readiness → product card/PDP → cart → delivery quote → checkout session
→ order transaction/stock reservation → payment or COD/bank
→ shipment/label → fiscal receipt → email → delivery
→ return/refund → stock/payment/fiscal reconciliation
```

The flow stops at the first step today because no active product is ready.

### Route inventory

- Public/shop: homepage; promotional/collection/category/search listings; PDP;
  cart; three-step checkout; contact/about/help/service; comments,
  reclamations, cookie/data deletion, privacy, terms, purchase and delivery
  policies; sitemap and robots.
- Account/auth: login, registration, verification, forgotten/new password,
  dashboard, addresses, wishlist, orders, reclamations, settings, export and
  deletion APIs.
- Admin: dashboard, homepage/content/banner/navigation/category/pictogram,
  complete ERP workspace, delivery, vouchers, payments, fiscalization,
  checkouts, complaints, XML, newsletter, Viber, ads, recommendations, reports,
  visits/conversion, publication QA, requirements matrix, and audit log.
- Integration APIs: catalog/search/wishlist/cart/checkout, payments, refunds,
  courier, fiscal, email, feeds, analytics, partners, uploads, webhooks, and
  scheduled jobs.

The successful build enumerated the complete route tree; the source contains
145 `page.tsx`/`route.ts` entry files plus the proxy.

## C. Feature status table

| Area | Feature | Status | Tested | Result | Issue | Severity | Required action | Owner | Blocker | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Build | Production build | Complete | Yes | Pass | None | — | Keep in CI | Engineering | No | Next build: 76 static pages, TS pass |
| Quality | Lint | Complete | Yes | Pass after fixes | Five lint errors fixed | Fixed | Keep required in CI | Engineering | No | `npm run lint` exit 0 |
| Quality | Unit tests | Complete | Yes | 30/30 pass | Coverage remains narrow | Medium | Add commerce/integration tests | Engineering | No | 11 files, 30 tests |
| Quality | E2E suite | Partially complete | Yes | 4 pass, 10 skipped locally | Password reset and tagged admin credentials unavailable to final run | High | Run full isolated CI/staging suite | QA/DevOps | Yes | Playwright final run |
| Public | Homepage | Working with minor issues | Yes | Correct content, very slow/heavy | ~12.9 s, 429 KB local HTML | High | Cache/batch home rails and load-test | Engineering | No |
| Public | Promo/category/listings | Working with minor issues | Yes | Routes load, cards responsive | Some pages 388 KB; catalog content incomplete | High | Complete catalog and optimize payload | Content/Engineering | Yes |
| Public | Search | Working with minor issues | Yes | Correct results and cards | ~2.1 s remains above ideal | Medium | Add cache/index timing telemetry | Engineering | No | Improved from ~11.2 s |
| Public | PDP | Working with minor issues | Yes | Gallery/content loads | ~4.4 s, 273 KB | High | Cache product reads, reduce related payload | Engineering | No |
| Media | Card first image | Complete | Yes | Pass desktop/mobile | Cache-clear/throttle not directly available | Low | Run a throttled CI browser case | QA | No | Ordered first image, blur placeholder |
| Media | One/multi/no-image cards | Complete | Yes | Pass | 68 products lack media | High | Supply final media | Client/Content | Yes |
| Media | Upload/reorder/delete lifecycle | Could not test | Source only | Not mutated | Needs isolated storage fixtures | High | Staging upload acceptance | QA/Content | Yes |
| Cart | Add/change/remove | Broken by content gate | UI/source | No eligible product | Zero ready products | Blocker | Complete dimensions/media/stock | Client/Content | Yes |
| Checkout | Session/order | Broken by content gate | API/source | Cannot start valid sale | No eligible product/full sale test | Blocker | Tagged staging/production acceptance | Business/QA | Yes |
| Auth | Protected redirects | Complete | Yes | Pass | None | — | Keep regression | Engineering | No |
| Auth | Registration/login/reset/verification | Partially complete | Source + route + partial E2E | Protection/rate limits present | Full reset/verification delivery skipped | High | Isolated end-to-end email/auth run | QA | Yes |
| Account | Own data/export/deletion/orders | Partially complete | Route/API/source | Server guards present | Destructive/data lifecycle not executed | High | Staging lifecycle test | QA/Legal | Yes |
| Admin | Route inventory/page load | Complete | Yes | 31 canonical routes pass | None | — | Keep smoke matrix | Engineering | No |
| Admin | Four-role RBAC | Complete | Yes | Pass desktop/mobile with isolated accounts | Final local suite skipped without env creds | Medium | Keep tagged CI fixtures | DevOps | No |
| Admin | Create/edit/import/export/delete | Could not test | Source/page only | UI and APIs exist | No safe isolated mutation data | High | Full staging admin acceptance | QA/Admin owners | Yes |
| Payments | COD cash/card + bank | Partially complete | Config/source | Visible/enabled in DB | No order can be placed | Blocker | Full tagged sale/reconciliation | Business/QA | Yes |
| Payments | IPS/cards/wallets | Requires client input | Env/source | Correctly hidden/gated | Acceptance flags and/or credentials incomplete | Blocker | Provider acceptance or disable config | Client/Bank | Yes |
| Email | Newsletter success/failure UX | Complete | Yes | 4/4 desktop/mobile E2E pass | None | — | Keep E2E | Engineering | No |
| Email | Transactional delivery | Partially complete | DB/source | Retry/logging exists | 14 FAILED, 4 SENT; delivery not accepted | Critical | Domain/webhook/delivery tests | Client/Engineering | Yes |
| Courier | MyGLS | Partially complete | Source/DB/env | Integration exists | Missing pickup contacts/gate; 2 failed shipments | Blocker | Complete/accept tagged shipment | Warehouse/Client | Yes |
| Courier | X Express | Partially complete | Source/DB/env | Webhook/signature code; 1 picked up history | Production gate off | Blocker | Provider acceptance | Client/Courier | Yes |
| Fiscal | BADI | Partially complete | Source/DB/env | Issue/retry/refund code exists | Location/gate missing; 1 failed record | Blocker | Accountant/provider acceptance | Client/Finance | Yes |
| Storage | Public product/private PII buckets | Complete | Source/config/DB policy | Correct design | Lifecycle cleanup not executed | Medium | Staging lifecycle test | Engineering | No |
| Security | RLS and API grants | Complete | Yes | 125/125 public tables RLS; no anon/auth grants | None | — | Run hardening after Prisma CLI | Engineering | No |
| Security | Headers/webhooks/rate limits | Complete | Yes | CSP, frame, MIME, referrer, permissions; signed callbacks | CSP still permits inline scripts/styles | Enhancement | Nonce migration later | Engineering | No |
| Security | Dependency advisories | Complete | Yes | Zero production vulnerabilities | Point-in-time result | — | Repeat in CI | Engineering | No |
| SEO | Metadata/sitemap/robots/admin noindex | Working with minor issues | Source/HTTP | Present and reachable | Full structured-data crawl not run | Medium | Production crawl after domain setup | SEO/QA | No |
| Legal | Policies/consent/data deletion | Partially complete | Route/source | Mechanisms exist | Official client/legal review incomplete | Blocker | Approve business/legal content | Client/Legal | Yes |
| Monitoring | Logs/health/runbook | Partially complete | Source/HTTP | Redacted logs and DB health work | No external alert delivery evidence | High | Configure log drain, uptime, alerts | DevOps | Yes |
| Backup | Backup and restore | Could not test | Runbook only | Procedure documented | Managed backup/PITR/restore drill not evidenced | Blocker | Enable and perform restore drill | DevOps/Client | Yes |

## D. Admin panel audit table

All rows below were checked with an authenticated temporary SUPER account in a
local production build. “No mutation” means the page, data, controls, routing,
layout, and authorization were inspected without changing business data.

| Admin page | Action tested | Result | Database result | Public result | Role restriction | Issue | Severity | Fix required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin` | Dashboard load/metrics/navigation | Pass | Read counts matched sampled DB | N/A | SUPER/allowed staff | Writes not applicable | — | None |
| `/admin/pocetna` | Load section configuration | Pass | Read only | No mutation | CONTENT/SUPER | Save/publish not executed | High | Staging mutation |
| `/admin/sadrzaj` | Load texts | Pass | Read only | No mutation | CONTENT/SUPER | Edit not executed | High | Staging mutation |
| `/admin/baneri` | Load placements/controls | Pass | Read only | No mutation | CONTENT/SUPER | Upload/schedule/delete not executed | High | Staging mutation |
| `/admin/promo-traka` | Load configuration | Pass | Read only | No mutation | CONTENT/SUPER | Save not executed | High | Staging mutation |
| `/admin/tabovi` | Load navigation editor | Pass | Read only | No mutation | CONTENT/SUPER | Reorder/save not executed | High | Staging mutation |
| `/admin/kategorije` | Load tree | Pass | Read only | No mutation | CONTENT/SUPER | CRUD not executed | High | Staging mutation |
| `/admin/piktogrami` | Load media mapping | Pass | Read only | No mutation | CONTENT/SUPER | CRUD/upload not executed | High | Staging mutation |
| `/admin/erp` | Workspace/navigation | Pass | Read only | N/A | Role-mapped | None on load | — | None |
| `/admin/erp/artikli` | 209-row table, controls, mobile overflow container | Pass | Read only | No mutation | CONTENT/SUPER | Create/edit/import/archive not executed | High | Staging mutation |
| `/admin/erp/dobavljaci` | Table load | Pass | Read only | No mutation | Role-mapped | CRUD not executed | High | Staging mutation |
| `/admin/erp/mp-cene` | Price table load | Pass | Read only | No mutation | Role-mapped | Price change not executed | Critical | Staging pricing test |
| `/admin/erp/stanje-po-magacinima` | Stock table load | Pass | Read only | No mutation | OPS/SUPER | Stock movement not executed | Critical | Staging concurrency test |
| `/admin/erp/prodajni-nalozi` | Order table load | Pass | Read only | No mutation | OPS/SUPER | Status/refund lifecycle not executed | Critical | Tagged order test |
| `/admin/erp/kupci` | Customer table load | Pass | Read only | No mutation | Restricted | Edit/export/privacy not executed | High | Staging privacy test |
| `/admin/dostava` | Rule page load | Pass | Read only | No mutation | OPS/SUPER | Quote impact not executed | Critical | Staging quote test |
| `/admin/vauceri` | Voucher page load | Pass | Read only | No mutation | Restricted | Create/redeem/race test absent | High | Staging redemption test |
| `/admin/placanje` | Payment toggles load | Pass | Config read: COD/bank on, electronic off | Methods reflect config | SUPER | Toggle/provider flow not executed | Critical | Provider acceptance |
| `/admin/fiskalizacija` | Fiscal dashboard load | Pass | 1 issued/1 failed history | N/A | OPS/SUPER | Issue/refund not executed | Blocker | BADI acceptance |
| `/admin/checkouti` | Checkout table load | Pass | Read only | N/A | OPS/SUPER | Recovery/expiry not executed | High | Tagged checkout test |
| `/admin/reklamacije` | Complaint table load | Pass | 1 received | N/A | OPS/SUPER | Status/photo/refund not executed | High | Staging lifecycle |
| `/admin/xml-import` | Import page and history load | Pass | Historical partial import visible | Catalog unchanged | Restricted | Dry/live import not executed | High | Isolated import fixture |
| `/admin/erp/newsletter-kampanje` | Campaign table load | Pass | Read only | N/A | Marketing roles | Send/unsubscribe not executed | Critical | Seed-list acceptance |
| `/admin/viber` | Campaign page load | Pass | Read only | N/A | Marketing roles | Provider/token placeholders | High | Provider acceptance |
| `/admin/oglasi` | Feed/ads page load | Pass | Read only | Public feeds unchanged | ADS/SUPER | Publish/reject sync not executed | High | Merchant acceptance |
| `/admin/preporuke` | Recommendation page load | Pass | Read only | No mutation | Restricted | Rule save/cart result not executed | Medium | Staging rule test |
| `/admin/izvestaji` | Report page load | Pass | Read only | N/A | Restricted | Export reconciliation not executed | High | Compare tagged sale |
| `/admin/erp/posete-konverzije` | Analytics table load | Pass | Read only | N/A | ADS/SUPER | Analytics not configured | Medium | Configure and verify |
| `/admin/erp/neobjavljeni-artikli` | Publication QA load | Pass | Exposed readiness gaps | Correctly blocks purchase | CONTENT/SUPER | All products incomplete | Blocker | Complete catalog |
| `/admin/erp/matrica-zahteva` | Requirements matrix load | Pass | Read only | N/A | Restricted | None on load | — | Maintain evidence |
| `/admin/audit-log` | Audit table load | Pass | Read only | N/A | SUPER | Mutation-linked audit not sampled | High | Staging mutation/audit |

Mobile `/admin/erp/artikli` had document width `390/390`; the 2,178 px ERP
table was contained by an intentional `overflow-x-auto` region. The “Otvori
meni” button opened a labeled admin navigation dialog successfully.

## E. Complete bug report

### Open findings

#### QA-001 — Zero products can be purchased

- Severity: **BLOCKER**
- Environment/role/route: configured database; visitor; all listing/PDP/cart
- Preconditions: active catalog loaded
- Steps: search `relax`; inspect purchase button; query catalog readiness
- Expected: at least one in-stock, complete product can be added to cart
- Actual: all 209 active products have missing dimensions; 68 also have no
  image. The only in-stock SKU (`1133`, stock 9) is disabled as “Uskoro
  dostupno”.
- Technical notes: `src/lib/catalog-readiness.ts` correctly prevents unsafe
  sale. Do not weaken this rule.
- Fix: import/enter valid width, depth, height and media; validate pricing,
  delivery window and stock; publish only accepted SKUs.
- Retest: open
- Production blocker: **Yes**

#### QA-002 — Production environment validation fails six gates

- Severity: **BLOCKER**
- Environment/role/route: `.env.local`; release operator;
  `npm run check:production-env`
- Steps: run the production environment check
- Expected: zero errors
- Actual: missing MyGLS contact name/phone, MyGLS acceptance, X Express
  acceptance, BADI fiscal location, and BADI acceptance.
- Fix: provide and validate values, or disable a provider that is not part of
  launch. BADI must follow accountant/fiscal-provider requirements.
- Retest: open
- Production blocker: **Yes**

#### QA-003 — Full sale and refund acceptance is unproven

- Severity: **BLOCKER**
- Routes: checkout, payment, shipment, fiscal, email and refund APIs/admin
- Steps: none safely available without accepted catalog/providers
- Expected: one tagged transaction reconciles across every subsystem
- Actual: no complete accepted transaction evidence
- Fix: execute the runbook’s tagged sale in an isolated/approved environment,
  including duplicate callback/retry and return/refund.
- Retest: open
- Production blocker: **Yes**

#### QA-004 — Transactional email delivery is not release-accepted

- Severity: **CRITICAL**
- Evidence: `EmailMessage` counts: 14 FAILED, 4 SENT
- Expected: accepted sender domain, webhook, delivery/bounce/complaint and
  transactional template tests
- Actual: code and logging exist, but delivery evidence is incomplete
- Fix: verify SPF/DKIM/domain/webhook; test welcome, verification, reset, order,
  fiscal, status, cancellation and refund messages using tagged recipients.
- Retest: open
- Production blocker: **Yes**

#### QA-005 — Storefront server response is too slow/heavy

- Severity: **HIGH**
- Routes: `/`, `/p/relax-1133`, listings
- Expected: production-like uncached responses near a normal interactive budget
- Actual after optimization: homepage ~12.9 s/428,670 bytes; PDP ~4.4
  s/272,605 bytes; search ~2.1 s/116,621 bytes. Measurements include remote DB
  latency and are not Web Vitals.
- Cause: multiple serial catalog queries through a one-connection process,
  dynamic rendering, large product/gallery serialization.
- Fix: cache homepage configuration/rails, precompute promo rails, measure SQL,
  reduce repeated product payload, add CDN/server cache policy, then load-test.
- Retest: partial; payloads and search improved, homepage still high
- Production blocker: No for a controlled soft launch; **Yes for a large
  traffic launch without load evidence**

#### QA-006 — Critical admin writes lack isolated acceptance evidence

- Severity: **HIGH**
- Role/routes: CONTENT/OPS/ADS/SUPER; all mutation APIs
- Expected: create/edit/publish/import/export/status/refund/delete persists,
  updates public output, and records an audit event
- Actual: source and UI exist; production-like data was intentionally not
  mutated
- Fix: provision staging fixtures and run the admin action matrix.
- Retest: open
- Production blocker: **Yes**

#### QA-007 — Backup, restore, and external monitoring are not demonstrated

- Severity: **BLOCKER**
- Expected: managed daily backups/PITR, object backup/versioning, completed
  restore drill, two-region health checks, 5xx/cron/provider alerts, log drain
- Actual: runbook exists; service configuration and delivered alerts were not
  available
- Fix: configure and attach evidence/owners; run one restore drill.
- Retest: open
- Production blocker: **Yes**

#### QA-008 — Courier/fiscal history contains unresolved failures

- Severity: **HIGH**
- Evidence: MyGLS FAILED 2; X Express PICKED_UP 1; fiscal FAILED 1 and ISSUED 1
- Expected: no unexplained failed production fixtures before launch
- Actual: failure records exist; provider acceptance gates remain off
- Fix: reconcile each record, classify/remove disposable fixtures without
  rewriting financial sequences, and complete provider acceptance.
- Retest: open
- Production blocker: **Yes**

#### QA-009 — Business contact and analytics configuration are incomplete

- Severity: **MEDIUM**
- Evidence: environment warnings for public support phone, return address and
  analytics; IPS configured but acceptance remains off
- Fix: provide approved contact/returns data; decide analytics/consent scope;
  accept or keep IPS hidden.
- Retest: open
- Production blocker: Legal/contact data **Yes**; analytics alone No

### Fixed during this audit

#### QA-010 — Suspected blank first product-card image

- Severity before retest: HIGH
- Result: not reproducible in current implementation
- Evidence: visible first images had `complete=true`, natural dimensions and
  active index 0; gallery state was isolated; browser back reset to image 1;
  mobile blur placeholder prevented blank state; one/no-image controls correct.
- Change: added `tests/unit/product-card-images.test.tsx`; listing preview
  galleries now query at most six ordered assets while PDP retains all assets.
- Retest: pass for tested desktop/mobile/search/back/one/multi/no-image cases.
- Remaining limitation: no direct cache purge, throttling, newly created image
  mutation, or second browser engine in this run.

#### QA-011 — Search page issued one full query per hit

- Severity: HIGH
- Cause: `Promise.all(hits.map(getProductBySlug))`
- Change: one ordered batch listing query via `getProductCardsBySlugs`.
- Result: local response improved from ~11.2 s/136,830 bytes to ~2.1
  s/116,621 bytes.
- Retest: pass

#### QA-012 — Listing payloads loaded every gallery image and unused counts

- Severity: HIGH
- Change: listing cards select six ordered preview images; homepage and PDP
  related rails skip unused count queries.
- Result: homepage HTML 574,850 → 428,670 bytes; PDP 409,335 → 272,605 bytes.
- Retest: build/unit/HTTP pass; homepage latency still needs work.

#### QA-013 — Lint failures in admin APIs/grid

- Severity: MEDIUM
- Cause: local `module` assignments and synchronous pagination reset in an
  effect; one unused courier argument.
- Change: renamed module variables, moved pagination reset into state-changing
  actions, keyed ERP grid by module, and consumed the adapter argument.
- Retest: `npm run lint` pass.

#### QA-014 — Newsletter E2E timed out on heavy homepage/mobile sticky header

- Severity: MEDIUM
- Change: target the lightweight contact page and submit through the email
  field, preserving the success/failure behavior under test.
- Retest: 4/4 desktop/mobile newsletter tests pass.

#### QA-015 — Public recommendation request accepted unbounded SKU arrays

- Severity: HIGH
- Change: Zod length/content bounds, deduplication and IP rate limits for cart
  recommendations; lookup endpoint also rate-limited.
- Retest: lint, TypeScript build and unit suite pass.

## F. Client input checklist

| Item | Why needed | Provider/owner | Blocks | Entry point | Sensitive | Current |
| --- | --- | --- | --- | --- | --- | --- |
| Complete SKU dimensions | Catalog safety, delivery and purchase eligibility | Merchandising/client | Yes | ERP Artikli/import | No | Missing for 209 active products |
| Final product images/alt/order | Sale quality and card/PDP readiness | Content/client | Yes | Product media/import | No | 68 products have none |
| Approved stock/prices/delivery windows | Correct sale and fulfillment | Commercial/warehouse | Yes | ERP | Commercial | Only one active SKU has stock |
| MyGLS pickup contact name/phone | Shipment creation | Warehouse/client | Yes if enabled | Hosting env/admin | Personal | Missing |
| MyGLS production acceptance | Enable real shipments | Warehouse/MyGLS | Yes if enabled | Secret acceptance flag | Yes | Off |
| X Express production acceptance | Enable real shipments | Client/X Express | Yes if enabled | Secret acceptance flag | Yes | Off |
| Fiscal location and BADI acceptance | Legal fiscal receipts | Accountant/BADI/client | Yes | Hosting env | Yes | Missing/off |
| IPS/RaiAccept production acceptance | Online payments | Bank/client | Yes if offered | Hosting env/provider portals | Yes | Off/placeholders |
| Sender domain, DNS and webhook approval | Reliable email | Domain owner/client | Yes | DNS/Resend/hosting env | Yes | Unverified |
| Public support phone/hours | Customer support/legal quality | Client | Yes | Merchant public env/admin | No | Phone missing |
| Warehouse and returns address | Shipping/returns/legal | Client/warehouse | Yes | Merchant public env/admin | Personal/business | Returns missing |
| Official company/tax/contact details | Legal documents/invoices | Client/legal/accountant | Yes | Content/fiscal settings | Business | Needs confirmation |
| Approved privacy/terms/purchase/returns text | Legal launch | Client/legal counsel | Yes | Content pages | No | Routes exist; approval unknown |
| Domain/DNS/SSL/deployment access | Publish and callbacks | Client/DevOps | Yes | Registrar/hosting | Yes | Not supplied to audit |
| Permanent admin owners for all roles | Operations separation | Client | Yes | Admin user provisioning | Yes | No permanent OPS/ADS observed |
| Backup/PITR/log/uptime plan and owner | Incident recovery | Client/DevOps | Yes | Supabase/hosting/monitoring | Yes | Not evidenced |
| Order/refund/reclamation process owners | Safe daily operations | Client | Yes | Runbook/admin | No | Needs acceptance |
| Analytics account and consent decision | Measurement | Marketing/legal | No | GA/Meta/TikTok env | Yes | Not configured |
| Social links and final branding/content | Publication quality | Marketing/client | No | Content/admin | No | Review required |

## G. Technical requirements checklist

### Environment inventory

Values were assessed without printing secrets.

| Group | Variables | Scope | Status/action |
| --- | --- | --- | --- |
| Database | `DATABASE_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `DATABASE_SSLMODE` | Server secret | Configured; keep runtime/migrations on the 5432 session/non-pooling value and run `db:harden` after direct Prisma commands. |
| Auth/app | `AUTH_SECRET`/`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_BASE_URL`, OAuth client IDs/secrets | Mixed | Core configured; social login provider acceptance not exercised. |
| Supabase | public URL/key, service role, product/reclamation/receipt/fiscal buckets | Mixed | Configured; only `product-media` may be public. |
| Cron/security | `CRON_SECRET`, per-job secrets, order/unsubscribe/inbound secrets | Server secret | Present by sanitized check; hosting schedules and delivered alerts unverified. |
| Email | provider, sender/reply-to/inboxes, Resend/Postmark keys, webhook/topic/segment values | Server secret/business | Code/config present; domain and transactional acceptance open. |
| MyGLS | account, pickup identity/address/contact, label bucket, cron, gate | Server secret/business | **Errors:** contact name/phone missing; acceptance off. |
| X Express | credentials, contract, code range, paths, webhook, cron, gate | Server secret | Enabled but acceptance off. |
| BADI/fiscal | provider, endpoint, location, TIN, cashier, credentials/VPFR, gate | Server secret | **Errors:** location missing; acceptance off. |
| IPS | base/callback/success/fail/cancel, TID/user, gate | Server secret/public URLs | Configured but gate off; production callback acceptance open. |
| RaiAccept/wallets | merchant/terminal/callback, public base, Google/Apple gates | Server secret | Merchant/terminal placeholders and gates off. |
| Viber | provider, endpoint, token, sender, webhook, gate | Server secret | Token/provider placeholders or unaccepted. |
| Feeds/ads/analytics | feed metadata, GA4, pixels, Meta CAPI | Mixed | Feed defaults exist; analytics warning/placeholders. |
| XML supplier | `XML_SUPPLIERS` and cloud/bulky integration values | Server secret | Placeholder/unverified production supplier configuration. |
| Merchant public data | phone, Viber, warehouse/returns address, support hours | Public | Support phone and returns address missing. |

### Infrastructure requirements

- [x] Production build from current working tree.
- [x] Database migrations present and 24 applied in inspected database.
- [x] RLS hardening and private-bucket design.
- [x] Vercel cron manifest and health endpoint.
- [x] Zero known production npm vulnerabilities at audit time.
- [ ] `check:production-env` returns zero errors.
- [ ] Production project/branch/domain/DNS/SSL/callback URLs verified.
- [ ] Full CI runs with isolated Postgres, seeded four-role credentials and all
  non-skipped critical tests.
- [ ] Managed database daily backup and PITR enabled.
- [ ] Object backup/versioning for private receipt/reclamation/label buckets.
- [ ] Successful isolated restore drill recorded.
- [ ] External uptime checks from two regions.
- [ ] Error/log platform, retention and alerts configured and delivery-tested.
- [ ] Tagged provider webhooks, cron invocations and retry jobs accepted.
- [ ] Load/soak test for homepage, search, checkout and critical APIs.

## H. Launch checklist

### Must be completed before launch

- [ ] Make at least the intended launch catalog purchasable by completing
  dimensions, media, prices, stock and delivery data.
- [ ] Resolve all six production environment errors.
- [ ] Reconcile existing email, shipment and fiscal failures.
- [ ] Complete one tagged full sale, delivery and return/refund acceptance.
- [ ] Execute critical admin mutation/audit workflows in isolated staging.
- [ ] Run password reset, verification and account deletion/export end to end.
- [ ] Approve legal/business/contact/returns/fiscal content.
- [ ] Enable backups/PITR/object protection and pass a restore drill.
- [ ] Configure and test uptime, 5xx, cron, payment, email, shipment and fiscal alerts.
- [ ] Verify production project, domain, DNS, SSL, callback/webhook URLs and secrets.
- [ ] Run final CI with no skipped critical release-gate tests.

### Strongly recommended before launch

- [ ] Reduce homepage server latency and prove capacity with load testing.
- [ ] Add a deterministic throttled browser image test and Firefox/WebKit pass.
- [ ] Add order/payment/refund/email/webhook integration tests.
- [ ] Batch the product lookup endpoint instead of its bounded per-SKU reads.
- [ ] Add SQL timing/error-rate dashboards and cache hit metrics.
- [ ] Crawl production SEO, structured data and broken links.
- [ ] Review accessibility with automated and keyboard/screen-reader tools.
- [ ] Clean or label all disposable users/orders/provider fixtures.

### Can be completed after a controlled launch

- [ ] Tighten CSP from inline allowances to nonce/hash-based policy.
- [ ] Add optional social login providers and marketing pixels after consent approval.
- [ ] Add richer card-gallery prefetch heuristics beyond six preview images.
- [ ] Expand non-critical visual regression coverage and admin wide-screen polish.

## J. Internal developer report

### Root causes and relevant code

- Purchase gate: `src/lib/catalog-readiness.ts`,
  `src/lib/product-availability.ts`; content fields in `Product`.
- Card image rendering: `src/components/product/product-card.tsx`;
  ordered media mapping in `src/lib/api/catalog.ts`; variants in
  `src/lib/media.ts`.
- Search N+1 fixed in `src/app/(shop)/pretraga/page.tsx` and
  `src/lib/api/catalog.ts`.
- Listing payload/count optimization in `src/lib/api/catalog.ts`,
  `src/lib/storefront/homepage.ts`, and PDP related rails.
- Public request hardening in
  `src/app/api/cart/recommendations/route.ts` and
  `src/app/api/products/lookup/route.ts`.
- Admin pagination/lint fix in `src/components/admin/erp-grid.tsx` and keyed
  mount in `src/app/admin/erp/[module]/page.tsx`.
- Admin guards: `src/lib/admin/guard.ts`,
  `src/lib/admin/erp-access.ts`, and guarded admin APIs.
- Storage rules/helpers: `src/lib/supabase/storage.ts`,
  `src/lib/api/uploads.ts`.
- Production checks/runbook: `scripts/check-production-env.mjs`,
  `docs/PRODUCTION_RUNBOOK.md`, `vercel.json`.

### Database/storage evidence

- 24/24 migrations applied; latest observed at
  `2026-07-18T18:40:16Z`.
- 125 public tables with RLS enabled; no `anon`/`authenticated` grants.
- 209 active products; 0 ready; 1 in stock; 68 without image.
- 917 product images; every stored image had card and PDP variants.
- 8 users, 2 verified; 5 historical orders, all canceled.
- Email: 14 failed, 4 sent.
- Reclamation: 1 received.
- Shipment: MyGLS failed 2; X Express picked up 1.
- Fiscal: failed 1, issued 1.
- Private buckets: `fiscal-receipts`, `order-receipts`,
  `reclamation-uploads`, `shipment-labels`.
- Public-by-design bucket: `product-media`.

### Network/performance evidence

Final local production build, remote configured database:

| Route | Status | Bytes | Time |
| --- | ---: | ---: | ---: |
| `/` | 200 | 428,670 | 12,875 ms |
| `/pretraga?q=relax` | 200 | 116,621 | 2,076 ms |
| `/p/relax-1133` | 200 | 272,605 | 4,379 ms |
| `/novo` | 200 | 96,885 | 2,101 ms |
| `/akcija` | 200 | 388,088 | 2,104 ms |

Security response headers verified: CSP, X-Content-Type-Options, X-Frame-Options,
Referrer-Policy, Permissions-Policy and Cross-Origin-Opener-Policy.

### Verification commands

```bash
npm run lint
npm run test:unit
npm run build
npm audit --omit=dev --audit-level=moderate
npm run check:production-env
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
```

Final results: lint pass; 30 unit tests pass; build pass; zero npm production
vulnerabilities; E2E 4 pass/10 skipped; production env check fails six errors.

### Retest instructions

1. Import a small approved launch catalog and run a readiness aggregation;
   require at least one ready/in-stock SKU and no unintended active/incomplete
   SKU.
2. Run the full E2E suite against isolated Postgres with all four role fixtures,
   email sink, test storage and provider sandboxes.
3. Execute every admin mutation from the audit table and compare database,
   public page, audit log and storage side effects.
4. Execute one tagged full transaction with provider IDs and expected totals.
5. Repeat image tests with cache disabled, Fast 3G, Firefox and WebKit.
6. Run load tests at agreed traffic/concurrency and observe database connections,
   p95/p99 latency, 5xx rate, memory and job lag.
7. Run `check:production-env` against hosting production—not a developer file—
   and require zero errors.
8. Verify backup restore and delivered alerts before changing the launch decision.

### Deployment instructions

1. Use `POSTGRES_URL_NON_POOLING`/port 5432 as `DATABASE_URL` for Prisma deploy.
2. Run `npm run db:deploy`; do not run raw Prisma changes without
   `npm run db:harden`.
3. Run lint, unit, build, complete E2E and environment checks.
4. Deploy with provider acceptance flags off.
5. Verify health/auth/catalog/checkout/admin/cron/webhook endpoints.
6. Enable one accepted provider at a time after its tagged acceptance.
7. Use a forward migration for database fixes; use hosting rollback for app-only
   incidents.

## K. GO/NO-GO launch decision

**NO-GO — not safe to publish for real users/orders yet.**

Direct evidence:

- `activeReadyInStock = 0`; the primary conversion flow cannot begin.
- Production environment validation returns six errors.
- Full sale/refund/provider acceptance has not occurred.
- Transactional email, courier and fiscal histories contain failures.
- Critical admin writes, backups/restore and external monitoring are not
  acceptance-tested.
- Homepage latency is not ready for an unbounded “large number of users” claim.

Reassess to **CONDITIONAL GO** only after every “Must be completed before
launch” item has dated evidence and an owner. Move to **GO** only after the
tagged transaction, restore drill, alert delivery and final clean release-gate
run succeed.
