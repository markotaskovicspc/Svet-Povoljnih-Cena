# Admin Panel and Provider Audit — 2026-07-16

## Executive summary

The admin panel is broadly usable on desktop and mobile, and all 27 top-level admin routes rendered locally and in production. Core catalog administration, a complete ERP purchase-order cycle, and a tagged customer order/cancellation cycle passed. Seven safe code defects were fixed, including a high-severity stale-session authorization defect.

The system is **not ready for an unrestricted production launch of email, IPS, MyGLS, or fiscalization**. The main blockers are configuration/provider state rather than missing admin screens: the Resend domain is unverified, the production Resend webhook secret/deployment is not active, IPS callbacks point to localhost, MyGLS pickup contacts are missing, and BADI rejects the configured sandbox credentials. Merchant legal information also contains placeholder values.

No audit parcel or payment was created. All mutable `AUDIT-20260716-*` fixtures, temporary admins, failed audit email rows, and the private audit receipt PDF were removed. The product used in the order test was restored to its exact starting stock.

## Classification rules

- **Done:** the tested happy path, persistence, permissions/feedback where exercised, and relevant tested edge cases pass.
- **Partially done:** the capability exists but a material path, provider, configuration, role, or edge case remains unverified or broken.
- **Left:** missing, unsafe for production, blocked, or not implemented.

## Scope and method

- Local application: `http://localhost:3100` at desktop `1280×800` and mobile `390×844`.
- Production application: `https://www.svetpovoljnihcena.rs` with one temporary `SUPER` admin approved by the owner.
- Real browser interaction was used for navigation, login, responsive layout, forms, CRUD, status transitions, and feedback.
- Direct provider/API calls were used only for safe read operations, provider test recipients, signed webhook fixtures, and the explicitly approved MyGLS attempt.
- Database inspection was used to verify persistence, stock, status history, idempotency, and cleanup.
- Genuine customer orders and permanent production content were not modified.
- Because one all-permission admin was requested instead of four role-specific accounts, the `CONTENT`, `OPS`, and `ADS` denial matrix is intentionally classified as unverified.

## Route and layout matrix

All routes below rendered locally at desktop and mobile widths without an application error or horizontal page overflow. The same 27 top-level routes rendered in production while authenticated as the temporary `SUPER` account.

| Area | Routes | Result |
| --- | --- | --- |
| Dashboard/content | `/admin`, `/admin/pocetna`, `/admin/sadrzaj`, `/admin/baneri`, `/admin/promo-traka`, `/admin/tabovi`, `/admin/kategorije`, `/admin/piktogrami` | Done |
| Catalog | `/admin/proizvodi`, product detail, `/admin/akcije`, `/admin/heroji`, `/admin/preporuke` | Partially done; render/layout passed, destructive product/media paths were not run against permanent catalog data |
| Commerce | `/admin/dostava`, `/admin/vauceri`, `/admin/placanje` | Done for render and tested voucher CRUD; not every permanent configuration was mutated |
| Operations | `/admin/erp`, `/admin/narudzbine`, order detail, `/admin/fiskalizacija`, `/admin/checkouti`, `/admin/reklamacije`, `/admin/komentari`, `/admin/xml-import` | Partially done; provider-dependent operations remain blocked |
| Marketing | `/admin/newsletter`, `/admin/viber`, `/admin/oglasi` | Partially done; Resend/Viber live delivery remains blocked |
| Analytics | `/admin/izvestaji`, `/admin/audit-log` | Done for render, filters, empty/error presentation; full business reconciliation was not independently recalculated |

Additional layout checks:

- Mobile sidebar is hidden and the menu drawer opens, exposes every expected navigation section, and closes correctly.
- Long category/product/advertising pages remained within the viewport.
- The existing in-progress layout changes for actions, categories, tabs, vouchers, and navigation were preserved and validated rather than overwritten.
- Admin login fields have accessible labels and submit from the keyboard. A complete focus-order/accessibility audit with assistive technology was not performed.

## Authentication, authorization, and sessions

| Test | Expected | Actual | Classification |
| --- | --- | --- | --- |
| Unauthenticated production access | Redirect to admin login with callback | Passed | Done |
| Invalid production credentials | Reject without creating a session | Passed with Serbian error feedback | Done |
| Temporary `SUPER` production login | Open full admin surface | Passed; all 27 routes rendered | Done |
| Disable active admin | Existing session loses admin access | Guarded page redirected to login | Done |
| Delete active admin, then open `/admin/erp` | Existing JWT must be rejected | **Production defect reproduced:** ERP still rendered because its page lacked a guard and the layout trusted the JWT | Fixed locally; deployment left |
| Retest deleted admin after fix | Every admin route redirects | Local `/admin/erp` redirected to `/admin/prijava?callbackUrl=%2Fadmin%2Ferp` | Done locally |
| Role restrictions | `CONTENT`, `OPS`, and `ADS` may access only allowed areas | Not exercised because only one `SUPER` account was authorized | Partially done |
| Natural session expiry | Session ends at configured lifetime | Configuration inspected; a 30/90-day wall-clock expiry was not waited out | Partially done |

### High-severity authorization fix

`src/app/admin/layout.tsx` now reloads the authoritative `AdminUser` on every admin request, rejects missing/disabled accounts, and refreshes the name and role from the database. This closes stale JWT access for pages such as `/admin/erp` and `/admin/erp/[module]` that did not independently call `requireAdminAction()`.

The fix is present in the working tree and passed the local reproduction. It is **not active in production until deployed**.

## Functional tests

### Content and catalog administration

| Capability | Evidence | Result |
| --- | --- | --- |
| Categories | Created `AUDIT-20260716-CATEGORY` with blank optional slug, verified automatic slug, edited, deleted | Done after validation fix |
| Actions | Created, listed, and deleted `AUDIT-20260716-ACTION` | Done for create/list/delete; edit not independently persisted |
| Vouchers | Created, submitted an edit, and deleted `AUDIT20260716` | Partially done; create/delete passed, but the immediate post-edit UI read was stale |
| Navigation tabs | Created a tagged slot-10 tab, verified it in the list, deleted it | Done |
| Product detail | Existing product detail, media controls, pricing, stock, and metadata rendered | Partially done; permanent product mutation and real media upload were intentionally not performed |
| Banners, promo, homepage, pictograms, heroes, recommendations, pages | Forms, current data, empty states, and responsive layout rendered | Partially done; permanent production content was not changed |
| Comments/reclamations/newsletter/ads | Lists, filters, controls, and empty states rendered | Partially done; genuine records were not modified |

The category schema incorrectly rejected the UI's blank optional slug and image URL. Blank slug now maps to `undefined` so automatic slug generation works; blank image URL maps to `null`.

### ERP

All ERP routes rendered: articles, suppliers, purchase prices, purchase orders, purchase orders by article, inbound invoices, and retail prices. Search and filters passed.

A tagged purchase order completed this lifecycle:

1. Draft created with one product line.
2. Header/supplier edited and persisted.
3. `DRAFT → SENT → RECEIVED` transitions completed.
4. Status events were recorded.
5. `receivedQty` became 1.
6. Warehouse stock increased by 1 and an adjustment movement was created.
7. Product cost was recalculated to 10,000 RSD.
8. Cleanup removed the movement, warehouse stock, purchase order, and events and restored the original null cost and stock 9.

The purchase-order editor used uncontrolled fields that retained stale values after a server refresh. The header form now remounts on `updatedAt`, and the supplier field was retested successfully.

ERP CSV export was triggered, but the browser download event did not complete before the automation timeout. The export control exists; the downloaded file contents remain unverified.

### Customer-to-admin order lifecycle

A real local checkout request created a tagged guest COD order with one unit of SKU 1133:

| Check | Expected | Actual |
| --- | --- | --- |
| Server-side price | Ignore client totals and calculate catalog/delivery price | 10,000 RSD item + 990 RSD delivery = 10,990 RSD |
| Stock reservation | Decrement once at checkout | 9 → 8 |
| Initial records | Order, `KREIRANO` event, COD payment, buyer receipt | Created; COD payment `PENDING`, proforma generated |
| Admin transitions | Persist history and feedback | `KREIRANO → POTVRDJENO → U_PRIPREMI → OTKAZANO` passed |
| Cancellation | Restore stock once | 8 → 9 and `stockRestoredAt` recorded |
| Repeated cancellation | Do not restore twice | Stock remained 9; an additional audit/status event was recorded |
| Receipt resend | Regenerate and try email | UI reported regeneration but unconfirmed send; provider returned the expected Resend domain error |
| Fiscal records | None unless explicitly issued | None created |
| Cleanup | Remove order, email rows, receipt PDF, temp admin | Passed |

`SPREMNO_ZA_ISPORUKU`, live shipment, delivered, and refund transitions were not forced because they would invoke blocked or consequential providers. Those paths remain partial/left as described below.

## Provider and integration results

### Resend

| Test | Actual | Classification |
| --- | --- | --- |
| API key authentication | Key authenticated | Done |
| Domain | `svetpovoljnihcena.rs` is `not_started` | Left/blocker |
| Official test recipients | Delivered, bounced, complained, and suppressed sends all returned 403 because the sending domain is unverified | Partially done |
| Production webhook | `/api/email/events` returned `503 not_configured` | Left/blocker |
| Local webhook signature | Valid signature accepted; missing/invalid/stale signatures rejected | Done |
| Malformed payload | Previously produced 500; now returns 400 | Done after fix |
| Duplicate webhook | Second delivery returned `duplicate: true` without duplicate persistence | Done |
| Bounce/suppression | Message status and suppression were persisted | Done locally |
| Newsletter contact sync | Subscribe and unsubscribe states reached Resend; provider contact deleted during cleanup | Done after fix |
| Order and receipt email paths | Correctly attempted and persisted provider failure | Partially done until domain verification |

Resend contact sync fixes:

- Newsletter subscribers now opt into the configured promotional audience/topic path.
- If optional custom properties have not been created in Resend, contact create/update retries without those properties instead of failing the whole synchronization.

Production end-to-end email remains blocked until the domain is verified, the production webhook secret is configured, and the deployment containing the webhook handler is active.

### MyGLS

- Production authentication/master data passed: HTTP 200 with 4,766 locations and no provider errors.
- After explicit owner confirmation, a dedicated tagged order attempted one real production parcel.
- The application stopped before calling MyGLS with: missing pickup `contactName` and `contactPhone`.
- Database verification showed no shipment, tracking number, provider parcel ID, or label object.
- The tagged order was deleted. No provider parcel existed to delete.

Classification: **Partially done** for authentication/configuration validation; **Left** for live create/label/status/COD/delete until `MYGLS_PICKUP_CONTACT_NAME` and `MYGLS_PICKUP_CONTACT_PHONE` are configured.

### IPS

The configured public base URL and callback resolve to localhost, and local port 3000 is a different application. The callback is not publicly reachable. Per the safety plan, no QR session, 1 RSD payment, fiscal record, or refund was attempted.

Classification: **Left/blocker** until public callback and success URLs target the deployed shop. Then repeat the scan/payment/refund checkpoint with the owner present.

### BADI fiscalization

The configured sandbox `/products` authentication returned HTTP 401. No sale or refund receipt was created.

Classification: **Left/blocker** until sandbox credentials/environment are corrected. Idempotency and sale/refund failure reconciliation remain unverified live.

### X Express

- Status/master data endpoint passed: HTTP 200 with 50 status records.
- Configuration and synchronization code are present.
- No second live parcel was created because MyGLS is the selected carrier.
- An address-check configuration flag exists, but no implemented client/use of provider address validation was found.

Classification: **Partially done** for authentication/master data/status synchronization; **Left** for address validation and live parcel flow.

### Viber

- `VIBER_PROVIDER=none`; real sending is disabled by configuration.
- Invalid webhook secret returned 401.
- Valid-secret malformed payload returned `invalid_payload`.
- Unattributed delivered event was safely ignored.
- Repeated `failed` callbacks are not idempotent: counters can be decremented/incremented more than once because no provider-event uniqueness record is stored.

Classification: **Left** for real sending and failed-event idempotency.

### Feeds and other email paths

- Google XML feed: HTTP 200 locally and in production.
- Meta CSV feed: HTTP 200 locally and in production.
- Budget feed: unauthorized request correctly returned 401.
- Registration/reset/reclamation templates and administrative controls were inspected, but live delivery is blocked by the Resend domain state.
- Private storage rules were preserved. The audit order receipt was accessed server-side and its private object was removed during cleanup.

## Defects and blockers

| Severity | Defect | Reproduction / evidence | Status |
| --- | --- | --- | --- |
| P0 | Deleted/disabled admin JWT could still render unguarded ERP pages | Login, delete admin, open `/admin/erp`; production rendered ERP | Fixed locally in shared admin layout; deploy required |
| P0 | Merchant legal/business configuration contains placeholder PIB and other placeholder identity/bank/contact values | Configuration inspection | Left; owner/accounting input required before invoices/fiscal go-live |
| P1 | Resend sending domain unverified | All official test-recipient sends return 403 | Left |
| P1 | Production Resend webhook not configured | Production endpoint returns 503 | Left |
| P1 | IPS callback/success URLs point to localhost/wrong local service | Environment and live URL inspection | Left |
| P1 | MyGLS pickup contacts missing | Tagged parcel attempt stopped before provider call | Left |
| P1 | BADI sandbox authentication fails | `/products` returns 401 | Left |
| P1 | X Express address validation is configured but not implemented/used | Code inspection | Left |
| P2 | Viber failed webhook is non-idempotent | Repeated failed event re-applies counters | Left |
| P2 | Local authentication redirect base points to port 3000 | Login/logout on port 3100 redirects to unrelated app on port 3000 | Left as local environment configuration |
| P2 | Two production navigation tabs use an old absolute Vercel URL | Production data inspection | Left; permanent content change requires owner confirmation |
| P2 | ERP CSV download could not be verified | Browser download event timed out | Partially done |
| P3 | Build static generation can exceed the database session pool | Non-fatal `EMAXCONNSESSION`, build still exits successfully | Left; reduce build concurrency or use appropriate pooling |

## Code changes made

1. `src/app/admin/layout.tsx` — authoritative account/role/enabled revalidation for every admin page.
2. `src/app/api/email/events/route.ts` — missing event ID and malformed/non-object JSON now return 400; signature validation and duplicate handling preserved.
3. `src/lib/email/resend-marketing.ts` — promotional audience sync and safe fallback when optional Resend properties do not exist.
4. `src/app/admin/kategorije/page.tsx` — blank optional slug/image handling; automatic slug creation now works.
5. `src/app/admin/erp/porudzbenice/[id]/page.tsx` — remount header fields after persisted updates to avoid stale uncontrolled values.
6. `src/components/admin/action-form.tsx` and product detail — removed explicit `encType` from function-action forms, eliminating React's method/encoding warning; function actions still submit file `FormData`.
7. `eslint.config.mjs` — ignore generated `.claude/**` content so repository lint checks project source instead of tool artifacts.

No public endpoint contract, database schema, pricing rule, accounting policy, provider credential, DNS record, or permanent production content was intentionally changed.

## Verification

- `git diff --check` — passed.
- `npm run lint` — passed.
- `npm run build` — passed with Next.js 16.2.9; compilation and TypeScript passed. A non-fatal Prisma `EMAXCONNSESSION` warning appeared during parallel static generation.
- No configured automated test suite exists in `package.json`; browser/API/database scenarios above provide the functional evidence.

## Cleanup ledger

Removed and verified absent:

- Temporary production and local `SUPER` admin accounts.
- Tagged category, action, voucher, navigation tab, newsletter subscriber/contact, purchase order, and both tagged orders.
- ERP stock movement and temporary warehouse-stock row; original product cost and stock restored.
- Local Resend webhook events and suppressions.
- Five failed tagged order email records.
- One private `order-receipts` PDF object.
- Temporary password file and in-task credential values.

Provider cleanup:

- Newsletter audit contact removed from Resend.
- MyGLS parcel: none created, so no external parcel remained.
- IPS payment: none created, so no refund was required.
- BADI receipt: none created.

Expected immutable residue:

- Order/PO number sequences may contain gaps from tagged tests; rewinding sequences would be unsafe.
- Audit-log records generated by legitimate admin actions may remain with a null actor after temporary admin deletion.

## Done

- Desktop/mobile rendering and navigation for every top-level admin area.
- Production `SUPER` login and read-only route sweep.
- Unauthenticated and invalid-login handling.
- Local deleted-account session revocation after the shared-layout fix.
- Category, action, voucher, and tab CRUD with cleanup.
- ERP search/filter and full purchase-order receive/stock/cost lifecycle with cleanup.
- Customer checkout, authoritative pricing, stock reservation, admin history, cancellation, cancellation idempotency, receipt generation/resend feedback, and cleanup.
- Local Resend webhook security, malformed payload handling, deduplication, bounce/suppression persistence, and newsletter contact sync.
- MyGLS and X Express authentication/master-data checks.
- Google/Meta feed availability and budget-feed authorization.
- Lint, TypeScript, production build, and working-tree whitespace checks.

## Partially done

- Role/permission coverage: `SUPER` passed; `CONTENT`, `OPS`, and `ADS` denial paths were not tested by owner choice.
- Natural session expiry and complete keyboard/screen-reader audit.
- Product/media, banners, homepage content, heroes, recommendations, payment/delivery settings, comments, and reclamations: screens and controls passed, but permanent production mutations were intentionally avoided.
- ERP export: action triggered, downloaded file unverified.
- Order fulfillment after preparation: shipment/delivery/fiscal/refund paths depend on blocked providers.
- Resend: local webhook/contact behavior passes, but live sending and production webhook do not.
- MyGLS: auth/master data pass, live parcel creation blocked before provider call.
- X Express: master data/status pass, live parcel and address validation incomplete.

## Left

1. Deploy the stale-session, webhook, form, category, PO, and Resend contact fixes and repeat the production regression.
2. Replace merchant placeholder legal/PIB/bank/contact information with accountant-approved values.
3. Verify `svetpovoljnihcena.rs` in Resend, configure the production webhook secret and active webhook, then repeat delivered/bounced/complained/suppressed and end-to-end message tests.
4. Configure public IPS callback/success URLs; perform the owner-assisted 1 RSD payment, reconciliation, fiscalization, and refund.
5. Configure MyGLS pickup contact name/phone; repeat create/label/status/COD/delete with explicit confirmation.
6. Correct BADI sandbox authentication; test sale, duplicate/idempotent retry, failure recovery, refund, and local/provider reconciliation.
7. Implement and test X Express provider address validation.
8. Make Viber failed-event processing idempotent and configure a real provider if live sending is required.
9. Correct local auth base URL/port and replace old production Vercel tab URLs after owner approval.
10. Run role-specific authorization tests if separate `CONTENT`, `OPS`, and `ADS` accounts are later approved.
