# Complete Admin Panel & ERP Functional Audit

**System:** Svet Povoljnih Cena  
**Audit date:** 2026-08-07 (Europe/Belgrade)  
**Repository:** `/Users/luka/svet povoljnih cena`  
**Auditor role:** Principal QA / ERP / Full-stack / security-conscious systems audit  
**Verdict:** **NOT APPROVED**

## 1. Executive summary

The admin application has broad functional coverage and several strong foundations: role enforcement, core purchasing, warehouse, inventory, sales-order, partner-reservation, newsletter, Rabalux checkout, audit logging, exports, and many persistence paths were demonstrated end to end in an actual browser against an isolated PostgreSQL database. The production-shaped build, lint, and all 485 unit tests passed.

It is not ready for production approval. The connected operational database is one migration behind the code, contains no currently purchasable catalog product, and has a materially unhealthy Rabalux media queue. Production email delivery is failing because the sender domain is unverified. Fiscalization is not configured and has already attempted to use a placeholder URL. A repeatable test-environment URL-precedence defect can cause supposedly isolated tests to write fixtures to the connected database. Five high-severity production dependency advisories are also present.

No P0 data corruption or unauthorized financial operation was reproduced. Multiple P1 launch and business-continuity blockers were confirmed.

### Scope and counts

| Measure | Result |
|---|---:|
| Canonical admin/ERP page surfaces discovered | 58 |
| Canonical page surfaces opened in a real authenticated browser | 58 / 58 |
| Capability groups in the matrix below | 151 |
| Capability groups exercised/evaluated (PASS + FAIL + UNCERTAIN) | 133 |
| PASS | 89 |
| FAIL | 14 |
| UNCERTAIN | 30 |
| BLOCKED | 9 |
| NOT IMPLEMENTED | 9 |
| Confirmed P0 bugs | 0 |
| Confirmed P1 bugs / release blockers | 8 |
| Confirmed P2 bugs / risks | 4 |
| Confirmed P3 bugs | 0 |

“Page opened without crashing” is counted only as route/render evidence. It does not make that page’s unexercised actions PASS.

### Verification evidence

| Check | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run build` | PASS, Next.js 16.2.11 production build |
| `npm run test:unit` | PASS, 106 files / 485 tests |
| Production environment gate | FAIL: fiscal mode and fiscal location missing/placeholder; additional warnings |
| Runtime readiness on connected DB | FAIL: 58/59 migrations and zero purchasable products |
| Runtime readiness on clean isolated DB | PASS: 59/59 migrations, RLS/grants hardened, one ready/purchasable fixture |
| Authenticated browser route inventory | PASS, all 58 canonical routes rendered |
| Role browser acceptance | PASS, 4/4 (`SUPER`, `CONTENT`, `OPS`, `ADS`) |
| Critical ERP browser smoke | PASS on isolated rerun |
| Core isolated E2E cases | 29 passed; failures are separated below into product defects, environmental blocks, and stale/unstable tests |
| Integration persistence cases | 10/14 passed; 4 failures reproduced and classified below |
| `npm audit --omit=dev` | FAIL: 8 advisories (5 high, 3 moderate) |

## 2. Architecture and system map

### Application architecture

- Next.js 16 App Router application with React server components, server actions, and route handlers.
- Prisma ORM over PostgreSQL. The connected database is Supabase PostgreSQL through the non-pooler port 5432.
- Auth.js credentials authentication. Admin authorization is role-based with `SUPER`, `CONTENT`, `OPS`, and `ADS`.
- The “ERP” is primarily embedded in this application and database; there is no single external ERP endpoint acting as the system of record.
- Critical server mutations use `requireAdminAction`, re-check the enabled admin and role, and create audit records.
- Supabase Storage is used with `product-media` public and receipt/reclamation/shipment buckets private.
- Background jobs cover Rabalux media, buyer receipts, password reset, supplier reservations, newsletter sending, and other asynchronous operations.

### External integration edges

```text
Rabalux catalog/stock -> sync/preview/governance -> Product/SupplierStockSnapshot -> storefront/checkout
Admin/checkout -> SupplierFulfillment -> Rabalux email/reservation/pickup confirmation

Admin/order -> courier registry -> X Express or MyGLS -> Shipment/events/labels/webhooks
Admin/order/refund -> fiscal transport -> BADI/PFR -> FiscalDocument/lines/PDF/email

Admin/partner clients <-> scoped bearer API <-> stock and idempotent reservations
Admin imports/exports <-> XLSX/XML/PDF <-> operational PostgreSQL
Admin uploads -> signed/staged upload -> Supabase Storage -> persisted object key/URL
```

### Canonical authenticated route map exercised in the browser

| Area | Routes |
|---|---|
| Shell/content | `/admin`, `/admin/pocetna`, `/admin/sadrzaj`, `/admin/baneri`, `/admin/promo-traka`, `/admin/tabovi`, `/admin/kategorije`, `/admin/piktogrami` |
| ERP entry/product | `/admin/erp`, `/admin/erp/artikli`, `/admin/erp/neobjavljeni-artikli`, `/admin/erp/sifarnici-artikala`, `/admin/erp/admin-podesavanja` |
| Supplier/purchase | `/admin/erp/dobavljaci`, `/admin/erp/nabavne-cene`, `/admin/erp/porudzbenice`, `/admin/erp/porudzbenice-po-artiklima`, `/admin/erp/ulazne-fakture` |
| Pricing/promotion | `/admin/erp/akcije`, `/admin/erp/cenovnici`, `/admin/erp/akcijske-cene`, `/admin/erp/loyalty`, `/admin/erp/linearne-promocije`, `/admin/erp/mp-cene`, `/admin/erp/heroji-meseca`, `/admin/erp/pozicije-piktograma` |
| Inventory/logistics | `/admin/erp/magacini`, `/admin/erp/stanje-po-magacinima`, `/admin/erp/kretanja-zaliha`, `/admin/erp/popisi`, `/admin/erp/otpremnice`, `/admin/erp/preuzimanja` |
| Sales/CRM/accounting | `/admin/erp/prodajni-nalozi`, `/admin/erp/prodajni-nalozi/nova`, `/admin/erp/kupci`, `/admin/erp/partner-klijenti`, `/admin/erp/partner-rezervacije`, `/admin/erp/reklamacije-dnevnik`, `/admin/erp/racunovodstveni-registri`, `/admin/fiskalizacija` |
| ERP content/integrations | `/admin/erp/landing-strane`, `/admin/erp/mobilni-tabovi`, `/admin/erp/integracije` |
| Commerce/operations | `/admin/dostava`, `/admin/vauceri`, `/admin/placanje`, `/admin/checkouti`, `/admin/xml-import`, `/admin/sistem` |
| Marketing/analytics/audit | `/admin/newsletter`, `/admin/viber`, `/admin/oglasi`, `/admin/preporuke`, `/admin/izvestaji`, `/admin/erp/posete-konverzije`, `/admin/audit-log`, `/admin/komentari` |

`/admin/tabovi#mobile-tabs` was also checked as the legacy/anchor entry to the mobile-tab content. Dynamic detail/create routes were exercised by their corresponding E2E flows and are represented by their canonical module roots above.

### Data authority observed in code

| Data | Current authoritative source / conflict rule |
|---|---|
| Product master | Local admin DB. Rabalux may populate supplier-controlled fields; explicit local sync overrides are preserved. |
| DC stock | Warehouse stock imported from CSV/XLSX or corrected through admin stock operations; movements are persisted. |
| Rabalux stock | Supplier observation only while approved, enabled, and fresh for 30 minutes; reservations and safety policy reduce sellable quantity. |
| Web availability | Manual web flag always participates; automatic web flag is ignored while `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Rabalux has additional supplier eligibility rules. |
| Purchase cost / COGS | Inbound-invoice receipt and dependent-cost allocation update weighted COGS. |
| Retail/action/loyalty price | Dated price lists and promotion rules in the local DB; pricing engine selects active rules/priorities. |
| Orders | Local order/checkout transaction; supplier and courier fulfillment are downstream side effects. |
| Fiscal status | Local fiscal document records the request, response, status, attempts, and issued proof from the fiscal provider. |
| Audit | Local append-style `AuditLog`, keyed to the admin actor and action. |

The exact commercial rule for Rabalux minimum public quantity is unclear: the current worktree enforces supplier quantity strictly greater than 10 and also subtracts a one-unit safety stock, while the project-level operational note describes freshness, reservations, and a one-unit buffer without stating a >10 threshold. This requires business confirmation.

## 3. Complete module matrix

| ID | Module | Feature | Status | Severity | ERP Related | Evidence / notes |
|---|---|---|---|---|---|---|
| AUTH-01 | Authentication | Admin login with valid credentials | PASS | — | No | Real browser login and persisted session used for all 58 routes. |
| AUTH-02 | Authentication | Invalid/disabled admin rejection | PASS | — | No | Disabled configured account was rejected; temporary enabled audit account worked. |
| AUTH-03 | Authentication | Logout and session revocation | UNCERTAIN | — | No | Button rendered; complete logout/relogin persistence scenario was not isolated. |
| AUTH-04 | Authorization | `SUPER` direct-route access | PASS | — | Yes | Browser role suite. |
| AUTH-05 | Authorization | `CONTENT` allow/deny matrix | PASS | — | Yes | Browser role suite. |
| AUTH-06 | Authorization | `OPS` allow/deny matrix | PASS | — | Yes | Browser role suite. |
| AUTH-07 | Authorization | `ADS` allow/deny matrix | PASS | — | No | Browser role suite. |
| AUTH-08 | Authorization | Backend action/API role enforcement | PASS | — | Yes | All admin route handlers statically use the admin guard; direct-route tests passed. |
| AUTH-09 | Accounts | Customer password-reset consume/revoke/login | PASS | — | No | Isolated browser+DB acceptance passed. |
| AUTH-10 | Security | Rate limiting under sustained abuse | UNCERTAIN | — | No | Model and cleanup paths exist; load threshold behavior was not stress-tested. |
| AUTH-11 | Audit | Mutation actor/action/diff persistence | PASS | — | Yes | Supplier, inventory, partner, newsletter, mobile, and owner-critical suites asserted DB audit rows. |
| AUTH-12 | Audit | Audit-log viewer filters/export | UNCERTAIN | — | Yes | Route rendered; every viewer control was not exercised. |
| NAV-01 | Admin shell | All canonical admin routes render | PASS | — | Yes | 58/58 authenticated browser routes; no route-level crash/alert. |
| NAV-02 | Admin shell | Legacy ERP/product/order routes return 404 | PASS | — | Yes | Critical ERP smoke passed. |
| NAV-03 | Admin shell | Sidebar role-aware visibility | PASS | — | Yes | Four-role acceptance. |
| NAV-04 | Admin shell | Mobile admin navigation | UNCERTAIN | — | No | Routes rendered, but full responsive navigation interaction was not exhaustively clicked. |
| GRID-01 | Shared ERP grid | Exact and partial search | PASS | — | Yes | Article SKU exact search returned one correct row. |
| GRID-02 | Shared ERP grid | Empty-result state | PASS | — | Yes | Nonexistent article query showed the correct empty-state row. |
| GRID-03 | Shared ERP grid | Filter combinations | UNCERTAIN | — | Yes | Several suites use filters; exhaustive cross-column combinations were not run. |
| GRID-04 | Shared ERP grid | Sort ascending/descending | UNCERTAIN | — | Yes | Implemented in shared grid; not exhaustively verified per column. |
| GRID-05 | Shared ERP grid | First/middle/last pagination | UNCERTAIN | — | Yes | Connected dataset is large, but every boundary was not navigated. |
| GRID-06 | Shared ERP grid | Column chooser/width/reset | UNCERTAIN | — | Yes | Controls rendered; full persistence matrix not completed. |
| GRID-07 | Shared ERP grid | Saved personal views | UNCERTAIN | — | Yes | Article acceptance stopped before final saved-view assertion. |
| GRID-08 | Shared ERP grid | Filtered XLSX export | PASS | — | Yes | Browser download event and ERP export tests passed. |
| DASH-01 | Dashboard | Daily/period order KPIs | PASS | — | Yes | Reclamation/analytics acceptance asserted exact DB-backed metrics and filters. |
| DASH-02 | Dashboard | Stock and incoming-goods KPIs | PASS | — | Yes | Dashboard/report code covered by passing tests and live render. |
| DASH-03 | Dashboard | Reclamation metrics/top products | PASS | — | Yes | Exact metrics, top products, filters, dashboard/report exports passed. |
| DASH-04 | Reporting | Report center navigation | PASS | — | Yes | Route and role-aware destinations rendered. |
| DASH-05 | Analytics | Visits/conversions filters and consent model | PASS | — | Yes | Acceptance and unit coverage passed. |
| DASH-06 | QA catalog | Unpublished-product reasons | PASS | — | Yes | Readiness rules unit tests plus live route. |
| DASH-07 | ERP workspace | Requirements/status matrix | PASS | — | Yes | 67 requirement entries rendered; this is inventory evidence, not proof of their claims. |
| PROD-01 | Products | Product list/grid render | PASS | — | Yes | Real browser on connected 3,190-product dataset. |
| PROD-02 | Products | Create smallest numeric SKU | PASS | — | Yes | Passed desktop, mobile, WebKit; Firefox navigation had a test-run abort. |
| PROD-03 | Products | Reject duplicate manual SKU | PASS | — | Yes | Same isolated acceptance. |
| PROD-04 | Products | Full card field update and DB persistence | PASS | — | Yes | SKU, names, rich text sanitization, status, category, grouping, lookups, dimensions, stock, flags, and collection were asserted in DB. |
| PROD-05 | Products | Full card state survives reload | PASS | — | Yes | Browser form and DB poll confirmed saved values before the later storefront assertion. |
| PROD-06 | Products | Saved active product appears on storefront category | FAIL | P1 | Yes | Four browser profiles timed out looking for `N2212` after successful DB save. See BUG-007. |
| PROD-07 | Products | Inline edit and archive from canonical grid | UNCERTAIN | — | Yes | Acceptance selector became ambiguous when two rows had the same short name. |
| PROD-08 | Products | DTZ status without dates | PASS | — | Yes | UI save and DB state reached `DTZ`, active, no T&C dates. |
| PROD-09 | Products | Atomic article XLSX preview/apply | UNCERTAIN | — | Yes | Current UI uses preview/apply; the DTZ test still searches for removed legacy button text. |
| PROD-10 | Products | Inventory XLSX validation/preview/apply/rollback/idempotency | PASS | — | Yes | Isolated browser acceptance passed. |
| PROD-11 | Products | Product media upload/edit/delete | PASS | — | Yes | Owner-critical browser mutation suite persisted and cleaned media. |
| PROD-12 | Products | Article filtered Excel export | PASS | — | Yes | Browser download passed. |
| PROD-13 | Products | Automatic web/wholesale/export calculation | PASS | — | Yes | Full-card DB assertion and unit tests passed for tested cases. |
| PROD-14 | Products | Storefront/API availability message consistency | FAIL | P2 | Yes | API said “Spremno za poručivanje”; PDP showed “Isporuka 3–5 radnih dana”. See BUG-008. |
| PROD-15 | Products | Product page CDN cache plus live hydration | FAIL | P2 | Yes | `s-maxage=30` passed in production mode; hydrated message did not match availability API. |
| PROD-16 | Products | Rabalux approval columns available in operational DB | FAIL | P1 | Yes | Migration 0057 is pending; jobs report missing `supplierApprovalStatus`. See BUG-001. |
| PROD-17 | Products | Rabalux catalog sync idempotency/override preservation | UNCERTAIN | — | Yes | Five integration cases passed; two sync cases are blocked by an internally conflicting circuit-breaker fixture. |
| PROD-18 | Products | Rabalux stock freshness/reservation/safety behavior | UNCERTAIN | — | Yes | Unit cases pass, but >10 threshold versus stated business policy requires confirmation. |
| PROD-19 | Products | Rabalux media background processing | FAIL | P1 | Yes | 407 failed, 223 retry, 5 queued; schema and network errors. See BUG-003. |
| PROD-20 | Products | Current catalog contains purchasable products | FAIL | P1 | Yes | 2,236 active, 446 ready, zero purchasable. See BUG-002. |
| SUP-01 | Suppliers | Supplier list/search | PASS | — | Yes | Browser CRUD acceptance. |
| SUP-02 | Suppliers | Create/update/delete supplier | PASS | — | Yes | Full CRUD and cleanup passed. |
| SUP-03 | Suppliers | Duplicate/invalid validation | PASS | — | Yes | Browser and DB assertions. |
| SUP-04 | Suppliers | Concurrent automatic supplier numbering | PASS | — | Yes | Concurrency acceptance passed. |
| SUP-05 | Suppliers | Loading locations, currency, parity, terms | PASS | — | Yes | Supplier master acceptance. |
| BUY-01 | Purchase prices | Create/lookup/edit/export/delete | PASS | — | Yes | Isolated browser+DB acceptance passed. |
| BUY-02 | Purchase orders | Create and validate | PASS | — | Yes | Browser acceptance passed. |
| BUY-03 | Purchase orders | Status transitions and locking | PASS | — | Yes | Posting/locking acceptance passed. |
| BUY-04 | Purchase orders | PDF generation | PASS | — | Yes | Generated and validated by acceptance. |
| BUY-05 | Purchase orders | XLSX export | PASS | — | Yes | Real workbook export passed. |
| BUY-06 | Purchase orders | Send to supplier via development transport | PASS | — | Yes | Development/no-provider path passed and persisted. |
| BUY-07 | Purchase orders | Send to real supplier email | BLOCKED | P1 | Yes | Production Resend domain is not verified. |
| BUY-08 | Purchase-order lines overview | Pack, margin, weight, volume values | PASS | — | Yes | Purchase-order acceptance. |
| BUY-09 | Inbound invoices | Create/edit/open/lock | PASS | — | Yes | Isolated browser+DB acceptance passed. |
| BUY-10 | Inbound invoices | Receive goods and weighted COGS | PASS | — | Yes | Receipt and COGS assertions passed. |
| BUY-11 | Inbound invoices | Net/VAT/gross and dependent-cost allocation | PASS | — | Yes | Acceptance plus unit calculations passed. |
| PRICE-01 | Price lists | Dated retail/purchase/wholesale/export CRUD | UNCERTAIN | — | Yes | Route rendered; full pricing suite stopped after a stale ambiguous action-row selector. |
| PRICE-02 | Action prices | Action-product priority and dates | UNCERTAIN | — | Yes | Pricing engine unit tests pass; full browser acceptance did not complete. |
| PRICE-03 | Loyalty | Rule CRUD and price history | UNCERTAIN | — | Yes | Route rendered; end-to-end persistence not completed. |
| PRICE-04 | Linear promotions | Global/category/group discounts and cap | UNCERTAIN | — | Yes | Unit behavior exists; browser suite did not finish. |
| PRICE-05 | Retail price changes | Proposed/published price trace | UNCERTAIN | — | Yes | Route rendered; browser workflow not fully exercised. |
| PRICE-06 | Promotions | Multiple overlapping action business rule | UNCERTAIN | — | Yes | Explicit business decision required. |
| STOCK-01 | Warehouses | Multi-warehouse create/search/edit | PASS | — | Yes | Browser acceptance passed. |
| STOCK-02 | Warehouses | Exactly one active default warehouse | PASS | — | Yes | Connected DB integrity query returned exactly one. |
| STOCK-03 | Warehouse balances | Physical/reserved/available/incoming | PASS | — | Yes | Inventory acceptance and DB invariants passed. |
| STOCK-04 | Warehouse balances | Negative quantity prevention | PASS | — | Yes | Direct integrity checks returned zero invalid rows; validation tests pass. |
| STOCK-05 | Stock movements | Immutable movement creation | PASS | — | Yes | Stocktake/dispatch/inventory suites and DB consistency. |
| STOCK-06 | Stocktake | Create/count/difference/post | PASS | — | Yes | Browser posting acceptance passed. |
| STOCK-07 | Reservations | Partner API auth/scopes/rate/idempotency | PASS | — | Yes | Concurrent duplicate reservation acceptance passed. |
| STOCK-08 | Reservations | Expiry/release recalculates channels | PASS | — | Yes | Unit and DB invariants; no expired active rows. |
| STOCK-09 | Inventory | Concurrent edit conflict in two browser tabs | UNCERTAIN | — | Yes | Transactional paths inspected; two-tab overwrite scenario not fully executed. |
| SALE-01 | Sales orders | List/detail/search/filter | PASS | — | Yes | Sales-order browser acceptance passed. |
| SALE-02 | Sales orders | Create wholesale/export order | PASS | — | Yes | Browser+DB transaction passed. |
| SALE-03 | Sales orders | Update and protect invalid changes | PASS | — | Yes | Browser validations/protections passed. |
| SALE-04 | Sales orders | Delete allowed draft/order | PASS | — | Yes | Isolated cleanup path passed. |
| SALE-05 | Checkout | Search -> cart -> checkout entry | PASS | — | Yes | Live local catalog browser smoke passed. |
| SALE-06 | Checkout | Guest confirmation navigation | PASS | — | Yes | Mocked provider browser flow passed. |
| SALE-07 | Checkout | Rabalux supplier order and pickup confirmation | PASS | — | Yes | Feature enabled isolated browser flow persisted `SENT -> CONFIRMED` and audit diff. |
| SALE-08 | Checkout | Duplicate checkout/order protection | PASS | — | Yes | Idempotency covered by unit/integration tests; no duplicate connected-DB references found. |
| SALE-09 | Payments | Admin payment-method configuration | PASS | — | Yes | Owner-critical mutation suite persisted and reloaded. |
| SALE-10 | Payments | Real RAI card transaction | BLOCKED | P1 | Yes | No authorized live/sandbox provider execution in this audit. |
| SALE-11 | Payments | Real IPS transaction | BLOCKED | P1 | Yes | IPS is gated and credentials/provider acceptance are unavailable. |
| SALE-12 | Payments | Refund persistence and provider side effect | BLOCKED | P1 | Yes | Local idempotency code/tests exist; real fiscal/payment provider unavailable. |
| FISC-01 | Fiscalization | Fiscal list/detail local model | PASS | — | Yes | Route rendered; unit transport/status tests passed. |
| FISC-02 | Fiscalization | Real sale issue through BADI/PFR | FAIL | P1 | Yes | Production gate fails; prior row used placeholder URL. See BUG-005. |
| FISC-03 | Fiscalization | Real refund through BADI/PFR | BLOCKED | P1 | Yes | Missing mode/location/credentials and connected PFR. |
| FISC-04 | Fiscalization | Document amount/status DB invariants | PASS | — | Yes | Zero invalid math/status/proof rows in connected DB. |
| LOG-01 | Dispatch notes | Create/update/post stock decrement | PASS | — | Yes | Stocktake/dispatch browser acceptance passed. |
| LOG-02 | Dispatch notes | PDF/XLSX document | PASS | — | Yes | Acceptance and document code tests. |
| LOG-03 | eDispatch | Real eOtpremnica sandbox | BLOCKED | P1 | Yes | No sandbox credentials/acceptance. |
| LOG-04 | Pickup batches | Local batch CRUD and package derivation | PASS | — | Yes | Core package derivation is used by browser paths; stale test fixture manually created an incomplete line set. |
| LOG-05 | Pickup batches | MyGLS address creation | BLOCKED | P1 | Yes | Production acceptance lock and credentials not satisfied. |
| LOG-06 | Pickup batches | X Express booking | BLOCKED | P1 | Yes | Test account configured; real pickup contract acceptance unavailable. |
| LOG-07 | Couriers | Provider selection persistence | PASS | — | Yes | Owner-critical mutation and pickup flow persisted selected provider. |
| LOG-08 | Couriers | Cancel X Express shipment | NOT IMPLEMENTED | — | Yes | Cancel contract intentionally absent; business/API contract required. |
| LOG-09 | Shipments | Status/error integrity | PASS | — | Yes | Connected DB timestamp/status invariants returned zero invalid rows. |
| CRM-01 | Customers | Customer/company master model | PASS | — | Yes | Unit/customer-master coverage and route render. |
| CRM-02 | Customers | Full browser customer CRUD | UNCERTAIN | — | Yes | Route rendered; complete create/update/delete acceptance not run. |
| CRM-03 | Reclamations | Metrics/filter/top-products/report export | PASS | — | Yes | Browser acceptance passed. |
| CRM-04 | Reclamations | Full legal lifecycle/decision/resolution | UNCERTAIN | — | Yes | Model/tests exist; entire UI lifecycle was not executed in this run. |
| CRM-05 | Reclamations | Private photo signed access | PASS | — | Yes | Code and storage policy verified; bucket remains private. |
| CRM-06 | Comments | Moderation workflow | NOT IMPLEMENTED | — | No | Route exists but project requirement marks the module excluded. |
| CONTENT-01 | Content pages | List/edit/revision/publish | UNCERTAIN | — | No | Routes rendered; full browser CRUD not run. |
| CONTENT-02 | Landing pages | Create draft/publish/reopen and DB revisions | PASS | — | No | Business state completed twice; test then observed non-fatal Auth.js client fetch errors. |
| CONTENT-03 | Landing pages | Clean client runtime during navigation | FAIL | P2 | No | Repeated `ClientFetchError: Failed to fetch` although server logged session 200. Included in BUG-010. |
| CONTENT-04 | Banners | Live fallback materialization | PASS | — | No | Browser verified all built-in placements/images. |
| CONTENT-05 | Banners | Staged drag/drop upload | PASS | — | No | Upload endpoint returned 200, hidden staged key is the intended flow; legacy test incorrectly expected file input to remain populated. |
| CONTENT-06 | Promo bar | CRUD and active period | UNCERTAIN | — | No | Route rendered; overlap/current-action rule requires decision. |
| CONTENT-07 | Desktop tabs | Ten positions and destinations | UNCERTAIN | — | No | Route rendered; full reorder/persistence not exercised. |
| CONTENT-08 | Categories | Create/edit validation and persistence | PASS | — | Yes | Owner-critical mutation suite. |
| CONTENT-09 | Pictograms | Library CRUD and product/action assignment | UNCERTAIN | — | Yes | Routes rendered; mandatory-four policy unresolved. |
| CONTENT-10 | Hero of month | Selection/order/action link | UNCERTAIN | — | Yes | Route rendered; full mutation path not executed. |
| CONTENT-11 | Home sections | Six rows and banner positions | UNCERTAIN | — | No | Route rendered; full save/reorder/browser storefront verification not completed. |
| CONTENT-12 | Mobile shortcuts | Validate destination, save, upload, mobile link | PASS | — | No | DB and storage assertions passed through destination navigation. |
| CONTENT-13 | Mobile shortcuts | Hide and reorder | UNCERTAIN | — | No | Acceptance stopped at a transient duplicate-heading locator before these final steps. |
| MKT-01 | Newsletter | Manual audience preview/save | PASS | — | No | Browser+DB acceptance passed. |
| MKT-02 | Newsletter | Campaign versions/review/approval/send | PASS | — | No | Browser, background worker, recipients, audit assertions passed in dev transport. |
| MKT-03 | Newsletter | Public signup success/failure truthfulness | PASS | — | No | Both browser cases passed. |
| MKT-04 | Newsletter | Production email delivery | FAIL | P1 | No | Resend returns 403 because domain is unverified. See BUG-004. |
| MKT-05 | Viber | Campaign integration | NOT IMPLEMENTED | — | No | Explicitly deferred/excluded. |
| MKT-06 | Ads | Google/Meta operational integration | NOT IMPLEMENTED | — | No | Explicitly deferred/excluded. |
| MKT-07 | Recommendations | Three final recommendation modes | NOT IMPLEMENTED | — | No | Awaiting business decision. |
| INT-01 | Partner API | Scoped stock read | PASS | — | Yes | Auth/scope/stock acceptance passed. |
| INT-02 | Partner API | Concurrent idempotent reservation | PASS | — | Yes | Acceptance passed. |
| INT-03 | Rabalux | Real catalog/stock feed health | FAIL | P1 | Yes | Connected queue/feed operations are materially unhealthy. See BUG-003. |
| INT-04 | Ananas | Marketplace adapter | NOT IMPLEMENTED | — | Yes | Explicitly deferred and safely disabled. |
| INT-05 | XML feed | Existing import route | UNCERTAIN | — | Yes | Route rendered; strict required-field contract unresolved. |
| INT-06 | GA4 | `view_item`, `add_to_cart`, `begin_checkout` | PASS | — | No | Browser data-layer acceptance passed. |
| SYS-01 | System | Monitoring page and integration health render | PASS | — | Yes | Authenticated route rendered with operational status. |
| SYS-02 | System | Production environment readiness | FAIL | P1 | Yes | Fiscal errors and several warnings. |
| SYS-03 | System | Database migration parity | FAIL | P1 | Yes | 58 applied of 59 local migrations. See BUG-001. |
| SYS-04 | System | RLS and API-role grants | PASS | — | Yes | All public tables hardened in isolated readiness; connected policy checks passed. |
| SYS-05 | System | Private storage buckets | PASS | — | Yes | Receipt/reclamation/order/shipment buckets remained private. |
| SYS-06 | System | Backup restore drill | BLOCKED | P1 | Yes | No disposable production backup/restore target was provided. |
| SYS-07 | Background jobs | Retry/idempotency framework | PASS | — | Yes | Code/tests and successful newsletter worker demonstrate mechanism. |
| SYS-08 | Background jobs | Current queue health | FAIL | P1 | Yes | 411 failed, 223 retry, 5 queued. See BUG-003. |
| SYS-09 | Dependencies | Production dependency audit | FAIL | P1 | No | 5 high and 3 moderate advisories. See BUG-009. |
| SYS-10 | Accounting | Turnover register | NOT IMPLEMENTED | — | Yes | Explicitly deferred; current view is not certified. |
| SYS-11 | Accounting | Cancellation/refund register | NOT IMPLEMENTED | — | Yes | Explicitly deferred; current view is not certified. |
| SYS-12 | Accounting | KEP book | NOT IMPLEMENTED | — | Yes | Explicitly deferred; current view is not certified. |

## 4. ERP audit summary

| ERP flow | Direction | Tested | Status | Problems |
|---|---|---:|---|---|
| Product master | Admin -> DB/storefront | Yes | FAIL | DB save succeeds, but product did not appear in the expected category in four browsers. |
| Rabalux catalog | Supplier -> DB/admin | Partly | FAIL | Pending schema migration; queue failures; integration fixture conflicts with circuit breaker. |
| Rabalux stock | Supplier -> DB/storefront/checkout | Partly | UNCERTAIN | Freshness/reservations tested; commercial >10 threshold needs confirmation. |
| DC inventory import | XLSX -> DB/admin | Yes | PASS | Validation, preview, apply, rollback, and idempotent retry passed. |
| Warehouse/stocktake | Admin -> DB/movements | Yes | PASS | CRUD and posting passed; invariants clean. |
| Partner reservations | Partner -> API -> DB | Yes | PASS | Scope, rate, stock, concurrency, and idempotency passed. |
| Supplier master | Admin -> DB | Yes | PASS | Full CRUD/validation/concurrent numbering passed. |
| Purchase price | Admin -> DB/export | Yes | PASS | Full lifecycle passed. |
| Purchase order | Admin -> DB/PDF/XLSX/email | Yes | PASS/BLOCKED | Local flow passed; real email blocked by Resend. |
| Inbound invoice/COGS | Admin -> DB/stock/COGS | Yes | PASS | Full local lifecycle and calculations passed. |
| Price lists/promotions | Admin -> DB/storefront | Partly | UNCERTAIN | Unit engine coverage is strong; browser suite did not complete. |
| Sales orders | Admin/checkout -> DB/reservations | Yes | PASS | Create/update/validation/protection/delete passed. |
| Rabalux fulfillment | Checkout -> DB/supplier/admin | Yes | PASS | Feature-enabled local flow and pickup confirmation passed. |
| Dispatch note | Admin -> DB/stock/documents | Yes | PASS | Posting and documents passed. |
| Courier shipment | Admin -> X Express/MyGLS -> DB | Mock/partly | BLOCKED | Local logic exists; live pickup contracts/credentials not accepted. |
| Fiscal sale/refund | Admin/order -> BADI/PFR -> DB | Local only | FAIL/BLOCKED | Production config invalid; prior placeholder URL execution failed. |
| Accounting registers | DB -> admin/export | No | NOT IMPLEMENTED | Deferred and not certified. |
| Audit trail | Mutations -> DB -> admin | Yes | PASS/RISK | Records pass; operation and final audit record are not one atomic transaction. |
| Background jobs | DB queue -> integrations | Yes | FAIL | Large failed/retry backlog, especially Rabalux media. |

### Mapping, conflict, retry, and duplicate behavior

- SKU remains the local product code. Rabalux uses `supplierId + supplierExternalId` as the supplier identity; tests assert duplicate prevention.
- Supplier category mappings are explicit. Feed taxonomy is not meant to create arbitrary local categories.
- Local sync overrides preserve manually owned product fields against subsequent supplier syncs.
- Purchase, sales, stock, partner reservation, checkout, newsletter, and many external jobs use idempotency keys or locked transactional updates.
- Rabalux catalog safety checks reject a feed that omits more than the allowed share of existing supplier products. This is a sound protection, but the integration suite currently violates its own preconditions.
- Error records generally contain status, last error, attempts, and timestamps. However, the current backlog shows that observability has not resulted in operational recovery.
- No orphaned core financial or stock relationships were found in targeted connected-DB integrity queries. Negative stocks, invalid order quantities, invalid fiscal math/proofs, invalid inbound totals, expired active reservations, and stale running imports all returned zero.

## 5. Broken features and complete bug reports

# BUG-001 — Application schema is ahead of the connected operational database

**Severity:** P1  
**Module:** Database / Rabalux / product master  
**Feature:** Migration parity and runtime product columns  
**Environment:** Connected PostgreSQL on port 5432, 2026-08-07  
**Preconditions:** Current worktree/application code and configured connected database.  
**Steps to reproduce:**

1. Run `npm run check:runtime-readiness`.
2. Compare local Prisma migrations with `_prisma_migrations`.
3. Inspect failed `RABALUX_MEDIA_PRODUCT` jobs.

**Expected behavior:** All migrations required by deployed/current code are applied before jobs or requests use new columns.  
**Actual behavior:** 59 migrations exist locally, 58 are applied; `0057_rabalux_catalog_policy` is pending. 116 failed jobs report that `Product.supplierApprovalStatus` does not exist.  
**Frontend result:** Product/Rabalux admin routes render, but related mutations/jobs can fail later.  
**API result:** Code paths selecting new columns fail at runtime.  
**Database result:** Schema lacks columns expected by current code.  
**ERP result:** Supplier catalog/media synchronization is partially broken.  
**Error/log:** `Product.supplierApprovalStatus column does not exist`.  
**Root cause:** Migration 0057 has not been deployed/hardened in the connected database.  
**Business impact:** Supplier integration and catalog readiness cannot be trusted; deploying current code can break live operations.  
**Recommended fix:** Deploy via the repository’s `db:deploy` chain so `db:harden` runs afterward; verify 59/59 and replay only safe failed jobs.  
**Regression test:** Production readiness must fail CI/deployment when any migration is pending, then assert required RLS/grants after deploy.

# BUG-002 — Connected catalog has zero purchasable products

**Severity:** P1  
**Module:** Catalog / inventory / storefront  
**Feature:** Runtime commerce readiness  
**Environment:** Connected operational DB  
**Preconditions:** Current data and availability rules.  
**Steps to reproduce:**

1. Run runtime readiness against the connected non-pooler DB.
2. Count active, ready, and purchasable products.
3. Inspect missing dimension/readiness reasons.

**Expected behavior:** At least the launch assortment is active, priced, dimensioned, in stock/eligible, and purchasable.  
**Actual behavior:** 2,236 products are active, 446 are ready, zero are purchasable; 1,790 active products are missing required dimensions.  
**Frontend result:** Admin lists products, but the commerce catalog is not launch-ready.  
**API result:** Purchasable catalog query returns no qualifying launch assortment.  
**Database result:** No row satisfies the complete purchase-readiness predicate.  
**ERP result:** Inventory/master-data readiness is incomplete.  
**Error/log:** Runtime readiness: `No purchasable product is available`.  
**Root cause:** DC stock/master data have not been fully imported/audited, compounded by supplier availability policy and pending schema.  
**Business impact:** Customers cannot complete normal commerce against a real launch assortment.  
**Recommended fix:** Import and audit DC stock, repair product dimensions/prices/statuses, deploy migration 0057, then rerun readiness before enabling stricter automatic availability.  
**Regression test:** Deployment gate must require a minimum approved launch assortment with exact failure reasons.

# BUG-003 — Rabalux media/background queue is materially unhealthy

**Severity:** P1  
**Module:** Rabalux integration / background jobs  
**Feature:** Catalog media synchronization and retries  
**Environment:** Connected operational DB  
**Preconditions:** Existing job queue.  
**Steps to reproduce:**

1. Group background jobs by kind/status/attempt count.
2. Inspect failed and retry `RABALUX_MEDIA_PRODUCT` jobs.
3. Compare oldest queued/retry timestamps and maximum attempts.

**Expected behavior:** Jobs complete or retry to a recoverable state; exhausted jobs are triaged and replayable.  
**Actual behavior:** 407 Rabalux media jobs are failed, 223 are retrying, and 5 are queued. 290 exhausted jobs end in `fetch failed`, 116 fail on missing schema, and one upload received HTTP 413.  
**Frontend result:** Admin monitoring exposes failures, but catalog media can remain incomplete.  
**API result:** Media fetch/upload processing repeatedly fails.  
**Database result:** Large failed/retry backlog remains persisted.  
**ERP result:** Supplier product media are not reliably synchronized.  
**Error/log:** `fetch failed`; missing `supplierApprovalStatus`; upload too large (413).  
**Root cause:** Schema drift plus unresolved remote fetch/upload failures and insufficient operational recovery of exhausted jobs.  
**Business impact:** Approved products can remain unpublished or visually incomplete; retries consume capacity.  
**Recommended fix:** Apply migration first, classify HTTP/network failures, cap/resize assets before upload, add dead-letter/replay tooling, and replay tagged safe failures in batches.  
**Regression test:** Mock 404/413/429/500/timeouts and assert bounded retry, persisted classification, idempotent replay, and final media state.

# BUG-004 — Production email delivery fails because the sender domain is unverified

**Severity:** P1  
**Module:** Email / authentication / orders / newsletter  
**Feature:** Transactional and marketing delivery  
**Environment:** Connected operational email records / Resend  
**Preconditions:** Send email confirmation, password reset, newsletter opt-in, order confirmation, or status email.  
**Steps to reproduce:**

1. Trigger a real configured Resend message.
2. Inspect `EmailMessage` status/error.

**Expected behavior:** Provider accepts the verified sender and records `SENT`.  
**Actual behavior:** 23 messages are `FAILED`; recent real confirmations and newsletter opt-ins return 403 because `svetpovoljnihcena.rs` is not verified.  
**Frontend result:** User can receive a generic success/accepted state for flows that deliberately avoid account enumeration, but no email arrives.  
**API result:** Provider returns 403.  
**Database result:** `EmailMessage.status=FAILED` with provider error; a password-reset job also failed.  
**ERP result:** Purchase-order/customer communications can fail.  
**Error/log:** `resend:403 The svetpovoljnihcena.rs domain is not verified`.  
**Root cause:** Resend domain/DNS verification is incomplete.  
**Business impact:** Account confirmation, password reset, newsletter consent, order confirmation, and operational notifications are unreliable.  
**Recommended fix:** Verify the sending domain/DNS, validate From addresses, run provider health smoke, and replay only idempotent eligible messages.  
**Regression test:** Provider sandbox test plus readiness assertion that the configured domain is verified before production approval.

# BUG-005 — Fiscalization is misconfigured and a placeholder URL reached runtime

**Severity:** P1  
**Module:** Fiscalization  
**Feature:** Sale issue/refund transport  
**Environment:** Production-shaped configuration and connected DB  
**Preconditions:** Automatic pickup fiscalization or production environment gate.  
**Steps to reproduce:**

1. Run `npm run check:production-env`.
2. Inspect failed fiscal documents.

**Expected behavior:** A valid fiscal mode, location, endpoint, and credentials are required before an issue attempt.  
**Actual behavior:** `BADI_FISCAL_MODE` and `FISCAL_LOCATION_ID` are missing/placeholder. A failed `SALE/AUTO_PICKUP` document attempted to parse literal `GET_FROM_FISCAL_PROVIDER` as a URL.  
**Frontend result:** Fiscal route renders but real issue cannot be trusted.  
**API result:** Transport fails before a valid provider request.  
**Database result:** Fiscal document is `FAILED` with error; no issued proof.  
**ERP result:** Fiscal sale/refund pipeline is unavailable.  
**Error/log:** `fiscal:network Failed to parse URL from GET_FROM_FISCAL_PROVIDER`.  
**Root cause:** Placeholder secrets are truthy and configuration validation does not consistently reject them before runtime.  
**Business impact:** Legal fiscal issuance/refund is blocked; orders may reach fulfillment without a fiscal document.  
**Recommended fix:** Normalize known placeholder forms to unset, make readiness a hard deployment gate, configure BADI/PFR sandbox, then execute sale/refund acceptance.  
**Regression test:** Table-driven tests for empty, placeholder, malformed, sandbox, and production fiscal configuration.

# BUG-006 — Isolated DB tests can write to the connected database

**Severity:** P1  
**Module:** Test infrastructure / database safety  
**Feature:** Environment URL selection  
**Environment:** Local E2E run with local `DATABASE_URL` and connected `POSTGRES_URL_NON_POOLING` in `.env.local`  
**Preconditions:** Supply only a local `DATABASE_URL` override.  
**Steps to reproduce:**

1. Start the app with a local PostgreSQL `DATABASE_URL`.
2. Run `article-master.spec.ts` while `.env.local` still contains connected `POSTGRES_URL_NON_POOLING`.
3. Observe fixture DB location and login behavior.

**Expected behavior:** Explicit test `DATABASE_URL` selects the isolated DB consistently.  
**Actual behavior:** The test helper and runtime-readiness script prioritize `POSTGRES_URL_NON_POOLING`; the test created tagged fixtures remotely while the app used the local DB, then login timed out.  
**Frontend result:** Authentication fails because fixture and app are in different databases.  
**API result:** App cannot find the remotely created test admin.  
**Database result:** Test writes can reach the connected DB. All observed tagged leftovers were cleaned during this audit.  
**ERP result:** Potential contamination of production-like product/supplier/audit data.  
**Error/log:** Admin lookup `found: false` in local app despite fixture creation.  
**Root cause:** Inconsistent precedence among `DATABASE_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, and `POSTGRES_URL`.  
**Business impact:** A routine “isolated” acceptance run can mutate operational data.  
**Recommended fix:** Require a single `E2E_DATABASE_URL`, reject non-local hosts unless an explicit destructive-test acknowledgement is set, and remove fallback to production variables in test helpers.  
**Regression test:** Spawn with conflicting variables and assert the suite refuses to run rather than choosing the connected host.

# BUG-007 — Successfully saved product is absent from its storefront category

**Severity:** P1  
**Module:** Product master / catalog  
**Feature:** Admin-to-storefront publication  
**Environment:** Fully migrated isolated DB; desktop, mobile, Firefox, WebKit  
**Preconditions:** Valid active product fixture, category/group, price and stock.  
**Steps to reproduce:**

1. Open full product card.
2. Save SKU, short name `N2212`, status `SP`, category/group, price-related state, stock, dimensions, and web flags.
3. Confirm DB fields and automatic channels.
4. Open the target `/k/<root>/<group>` storefront route.

**Expected behavior:** The saved/eligible product appears after cache/revalidation within the 120-second acceptance window.  
**Actual behavior:** The admin save and comprehensive DB assertion pass, but `N2212` never appears. Reproduced in all four browser profiles.  
**Frontend result:** Category page loads without the product.  
**API result:** No explicit request error was shown.  
**Database result:** Product fields, stock, category, lookups, and channel booleans are correct.  
**ERP result:** Admin master data and customer-facing catalog diverge.  
**Error/log:** Playwright timeout waiting for `N2212`; category route returned HTTP 200.  
**Root cause:** Not fully isolated; likely catalog eligibility/query or invalidation/cache divergence after product mutation.  
**Business impact:** Admins can believe an item is published while customers cannot see it.  
**Recommended fix:** Trace the exact product through `webStorefrontProductWhere`, category relation query, and revalidation tags; show a deterministic publish-block reason in admin.  
**Regression test:** Keep the cross-browser test, but assert API/catalog eligibility first and include the rejected predicate in failure output.

# BUG-008 — Product availability API and PDP display different messages

**Severity:** P2  
**Module:** Storefront availability / product detail  
**Feature:** Live availability hydration  
**Environment:** Isolated DB, production `next start`  
**Preconditions:** One active, priced, stocked product.  
**Steps to reproduce:**

1. Request `/api/products/<slug>/availability`.
2. Open `/p/<slug>` and wait for the live availability request.
3. Compare API `availability.message` with visible `aria-live` text.

**Expected behavior:** The hydrated PDP displays the API’s current availability message.  
**Actual behavior:** API returned `Spremno za poručivanje`; PDP displayed `Isporuka 3–5 radnih dana`. Cache header and live request were otherwise correct.  
**Frontend result:** Stale/different message remains visible.  
**API result:** 200 with a different message.  
**Database result:** Product stock and price are valid.  
**ERP result:** Availability source is not presented consistently to the customer.  
**Error/log:** Storefront cache smoke assertion failure at the message comparison.  
**Root cause:** PDP and availability endpoint use different presentation state or client hydration does not replace the initial message.  
**Business impact:** Misleading delivery/availability information and inconsistent purchase expectations.  
**Recommended fix:** Use one availability presentation object for SSR and hydration and update label/message atomically.  
**Regression test:** Assert SSR state, API payload, hydrated state, and button label for DC, supplier, mixed, stale, and unavailable cases.

# BUG-009 — Production dependency audit contains five high-severity advisories

**Severity:** P1  
**Module:** Dependency/security posture  
**Feature:** Production dependency health  
**Environment:** Current lockfile, `npm audit --omit=dev` on 2026-08-07  
**Preconditions:** Install current locked production dependencies.  
**Steps to reproduce:**

1. Run `npm audit --omit=dev --json`.
2. Inspect vulnerability metadata.

**Expected behavior:** No unaccepted high-severity production advisories.  
**Actual behavior:** 8 advisories: 5 high and 3 moderate. High findings affect `brace-expansion`, `fast-uri`, `ip-address`, `js-yaml`, and `undici`; Next/PostCSS and Hono are moderate.  
**Frontend result:** No immediate visible failure.  
**API result:** Potential DoS, SSRF/trust-boundary bypass, request/response parsing, or information-disclosure exposure depending on reachable code paths.  
**Database result:** No direct corruption observed.  
**ERP result:** Availability and integration processes could be exposed to dependency-layer risk.  
**Error/log:** npm audit exit code 1.  
**Root cause:** Locked versions precede available patched versions.  
**Business impact:** Unreviewed known vulnerabilities in a production commerce/ERP application.  
**Recommended fix:** Upgrade non-breaking patches first (`brace-expansion` 5.0.9 and transitive patches), evaluate Next 16.3.0 per bundled docs, rerun build/unit/E2E/security review.  
**Regression test:** CI `npm audit --omit=dev` with an explicit, expiring allowlist for accepted advisories.

# BUG-010 — Acceptance suite is out of sync with current UI and has repeatable runtime/selector instability

**Severity:** P2  
**Module:** QA automation / Next.js client navigation  
**Feature:** Regression confidence  
**Environment:** Isolated DB, Next dev, Playwright desktop/mobile/Firefox/WebKit  
**Preconditions:** Run current opt-in E2E suites.  
**Steps to reproduce:**

1. Run DTZ, banner, pickup, pricing, landing, and mobile-shortcut suites.
2. Compare expected controls with current UI and server logs.

**Expected behavior:** Tests locate current accessible controls and fail only for business defects.  
**Actual behavior:** DTZ expects removed `Proveri i uvezi` instead of preview/apply; banner expects a deliberately cleared file input instead of staged upload key; pickup always expects `Proknjiži` although MyGLS correctly shows `Kreiraj adresnice`; pricing and article grids use ambiguous row selectors. Landing repeatedly records Auth.js `Failed to fetch` while the server logs 200, and mobile landing navigation transiently resolves two identical H1 elements.  
**Frontend result:** Core business writes often complete before the test fails.  
**API result:** Relevant requests frequently return 200.  
**Database result:** Expected mutations are present and cleanup succeeds.  
**ERP result:** Regression evidence is weakened; later workflow steps remain unverified.  
**Error/log:** Strict-mode locator errors, stale button-name timeout, Auth.js ClientFetchError.  
**Root cause:** Acceptance tests were not updated with staged upload, preview/apply, dynamic provider commands, and row scoping; transient navigation/session errors are treated as unconditional fatal errors.  
**Business impact:** Red suites mask real regressions and prevent reliable release gating.  
**Recommended fix:** Scope locators to selected rows/forms, assert staged upload keys, branch on provider, update import flow, and investigate/ignore only proven navigation-abort noise.  
**Regression test:** Make these suites stable for three consecutive isolated runs and retain traces only for genuine failures.

# BUG-011 — Critical mutation and final audit record are not atomic

**Severity:** P2  
**Module:** Audit architecture  
**Feature:** Critical mutation traceability  
**Environment:** Code inspection plus mutation tests  
**Preconditions:** Business operation succeeds but final audit insert fails.  
**Steps to reproduce:**

1. Execute a guarded action.
2. Force the post-operation success-audit insert to fail.

**Expected behavior:** Either the business operation and its mandatory audit record commit together, or a durable outbox guarantees the missing audit will be repaired.  
**Actual behavior:** `withAdminState` can return a warning that the operation was applied and must not be retried when the final audit write fails.  
**Frontend result:** User receives a special “applied, do not retry” failure/warning path.  
**API result:** Operation may be successful while final audit is unsuccessful.  
**Database result:** Business state can exist without its final success audit row.  
**ERP result:** Financial/stock traceability can be incomplete.  
**Error/log:** Architectural path observed in admin guard wrapper.  
**Root cause:** Business transaction and audit persistence are separate.  
**Business impact:** Compliance/forensic gaps and ambiguity during retries.  
**Recommended fix:** Put audit write in the same DB transaction where practical or write an atomic outbox entry that is guaranteed to materialize the audit.  
**Regression test:** Fault-inject audit persistence and assert all-or-nothing behavior or durable outbox recovery.

# BUG-012 — Production configuration is incomplete beyond fiscalization

**Severity:** P2  
**Module:** Deployment/readiness  
**Feature:** Customer support, returns, courier, and payment readiness  
**Environment:** Production environment gate  
**Preconditions:** Run production configuration validation.  
**Steps to reproduce:**

1. Run `npm run check:production-env`.
2. Review warnings and connected operational failures.

**Expected behavior:** Required production contact and provider configuration is verified before release.  
**Actual behavior:** Support phone and returns address are missing; X Express remains on a test account; BADI is sandbox/missing; IPS is gated.  
**Frontend result:** Customer-facing support/returns or payment/courier behavior may be incomplete.  
**API result:** Integrations are disabled or fail readiness.  
**Database result:** Three MyGLS failed shipments exist, including one unauthorized historical attempt; two others are explicit cleanup/deletion states.  
**ERP result:** Fulfillment and after-sales processes are not production-accepted.  
**Error/log:** Production env warnings and integration health output.  
**Root cause:** Required operational onboarding/configuration is unfinished.  
**Business impact:** Delivery, returns, support, and alternative payment operations may stop or require manual handling.  
**Recommended fix:** Complete provider onboarding and contact/address configuration, then execute signed-off sandbox/live acceptance.  
**Regression test:** Expand readiness to validate environment mode, account type, provider health, and required customer-facing fields.

## 6. Verified working features

The following were positively demonstrated; this list does not imply unlisted functionality works:

- Production build, lint, and 485 unit tests.
- Authentication with enabled admin, disabled-account rejection, and four-role page access matrix.
- All 58 canonical admin/ERP routes render for an authenticated super admin.
- Exact and empty-result article search plus filtered Excel download.
- Supplier full CRUD, validation, cleanup, and concurrent automatic numbering.
- Purchase-price lifecycle and export.
- Purchase-order create/validate/post/lock/PDF/XLSX/dev-send.
- Inbound invoice create/edit/open/lock/receive and weighted COGS.
- Multi-warehouse CRUD, stocktake posting, stock movements, and inventory import rollback/idempotency.
- Sales-order view/create/update/protection/delete.
- Partner bearer scopes, stock read, and concurrent idempotent reservations.
- Reclamation analytics, filters, top products, and exports.
- Newsletter audience, versioning, review, approval, background send, recipient delivery, and audit in development transport.
- Owner-critical product/category/delivery/voucher/payment mutations with DB and audit verification.
- Rabalux feature-enabled checkout, supplier fulfillment, pickup confirmation, and audit persistence in isolation.
- Search-to-cart-to-checkout entry, mocked guest confirmation navigation, GA4 commerce events, and password reset/session revocation.
- Product page production cache header and a single live availability request; message consistency failed separately.
- Connected-DB targeted integrity checks found no negative stock, invalid order items, invalid purchase/inbound/fiscal math, stale active reservations, or stale running imports/locks.
- RLS and no-grant posture for public API roles; sensitive storage buckets remained private.

## 7. Business logic clarification required

### CLARIFICATION-01 — Rabalux public-stock threshold

1. **Feature/module:** Rabalux availability.
2. **Current behavior:** Stock must be fresh for 30 minutes, supplier approved/enabled, quantity strictly greater than 10, then supplier reservations and a one-unit safety stock are subtracted.
3. **Why ambiguous:** The project operational note specifies freshness, reservations, and one-unit reserve but does not state a minimum >10 threshold.
4. **Possible interpretations:** Any quantity above the one-unit reserve is sellable; or only supplier observations above 10 are considered reliable/public.
5. **Exact question:** Should Rabalux supplier stock participate when raw quantity is 2–10, or only when it is strictly greater than 10?

### CLARIFICATION-02 — Automatic web availability rollout and customer wording

1. **Feature/module:** Product channels/storefront.
2. **Current behavior:** Vercel Production uses `ENFORCE_WEB_AUTO_AVAILABILITY=false`; manual web flags remain authoritative. Approved fresh Rabalux stock can show supplier availability and a delivery window, without exact quantity.
3. **Why ambiguous:** DC stock has not been imported/audited and the client may request a different supplier-stock or customer-label policy.
4. **Possible interpretations:** Keep manual availability; enable automatic DC only; enable combined DC+Rabalux; change “Dostupno kod dobavljača”/delivery wording.
5. **Exact question:** After DC stock is audited, should web availability use combined DC + approved fresh Rabalux stock, and what exact customer label/delivery promise should be shown?

Until answered, keep `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Safe rollback after any trial is `false` plus redeploy. In the “two toy boxes” model: the DC box comes from CSV/XLSX and can be manually corrected; the Rabalux box is time-limited, reserved, and should expose only the approved customer promise.

### CLARIFICATION-03 — External ERP boundary

1. **Feature/module:** Overall ERP integration.
2. **Current behavior:** The application itself contains the ERP modules and DB; external systems are supplier, courier, fiscal, payment, advertising, and marketplaces.
3. **Why ambiguous:** The audit request asks for Admin <-> ERP synchronization as if a separate ERP exists.
4. **Possible interpretations:** This app is the ERP; or it must synchronize with another accounting/ERP system not present in the repository.
5. **Exact question:** Is this application the authoritative ERP, or must it integrate with a separate named ERP/accounting platform? If separate, which entities and direction belong to that contract?

### CLARIFICATION-04 — Statutory accounting scope

1. **Feature/module:** Turnover, cancellation/refund registers, KEP.
2. **Current behavior:** Internal views exist, but requirements explicitly mark the statutory registers deferred and not certified.
3. **Why ambiguous:** Legal format, numbering, periods, closing, corrections, and export requirements are unspecified.
4. **Possible interpretations:** Internal operational reporting only; or legally compliant registers.
5. **Exact question:** Must these be Serbian statutory accounting registers, and which accountant-approved layouts/rules are authoritative?

### CLARIFICATION-05 — Content and marketing deferred rules

1. **Feature/module:** Promo overlap, “today’s action,” recommendation modes, mandatory pictograms, XML required fields, comments, Viber, ads.
2. **Current behavior:** Routes/placeholders exist for several items, but the project requirement matrix marks decisions deferred.
3. **Why ambiguous:** Expected precedence and business ownership are not specified.
4. **Possible interpretations:** Keep safely disabled; complete them for launch; or remove them from launch navigation.
5. **Exact question:** Which of these modules are in the production launch scope, and what are the exact rules for promo overlap, recommendations, pictogram count, and XML mandatory fields?

### CLARIFICATION-06 — Courier cancellation and live pickup contract

1. **Feature/module:** X Express/MyGLS pickup.
2. **Current behavior:** Booking/labels/manifest flows exist; X Express cancel is not implemented and production pickup is locked.
3. **Why ambiguous:** Provider cancellation semantics and acceptance contract are absent.
4. **Possible interpretations:** No electronic cancellation; void locally; or call a provider endpoint with status constraints.
5. **Exact question:** What is the signed provider behavior for cancel/rebook, and which test/production accounts are approved for launch acceptance?

## 8. Blocked tests

| Blocked area | Why | Required to unblock |
|---|---|---|
| Real BADI sale/refund | Missing mode/location/valid endpoint/connected PFR | Valid sandbox credentials, fiscal location, PFR, approved sale/refund fixtures |
| Real RAI/IPS payment | No authorized sandbox execution; IPS gated | Provider sandbox accounts and acceptance plan |
| Real MyGLS pickup/labels | Production safety lock and credentials/account acceptance | Accepted production/sandbox account and pickup window |
| Real X Express pickup/cancel | Test account only; cancel contract missing | Signed API contract and accepted account |
| eOtpremnica sandbox | Credentials/acceptance unavailable | Sandbox tenant and document fixtures |
| Production email | Resend domain unverified | DNS/domain verification |
| Backup restore | No disposable restore target | Recent backup plus isolated target and RTO/RPO criteria |
| External ERP sync | No separate ERP identified | Platform name, credentials, mappings, authority matrix |
| Ananas | Explicitly deferred | Business scope and API access |
| Viber/ads | Explicitly deferred | Business scope and provider access |
| Statutory registers/KEP | Requirements deferred | Accountant-approved specification |
| Production-domain browser acceptance | Audit used local servers with connected DB and isolated DB, not the public deployed origin | Approved staging/production URL and safe tagged mutation window |

## 9. Hidden and architectural risks

1. **Audit atomicity:** The business mutation and final success audit are not always a single transaction (BUG-011).
2. **Environment ambiguity:** Multiple DB URL variables have inconsistent precedence; placeholder secrets are truthy.
3. **Deployment ordering:** Prisma migration must always be followed by `db:harden`; direct Prisma use can leave new tables exposed to API roles.
4. **Background-job operations:** Failed/exhausted jobs are observable but lack demonstrated operator replay/dead-letter recovery at the current scale.
5. **Catalog release flag:** Strict automatic availability must remain off until DC stock import/audit and client policy confirmation.
6. **Supplier policy drift:** The >10 Rabalux threshold is not captured in the operational instruction and can silently change sellability.
7. **Regression-test drift:** Several opt-in acceptance suites no longer describe current controls and therefore cannot serve as a clean release gate.
8. **Live integration gaps:** Fiscal, payments, couriers, and eOtpremnica are critical business edges with no completed live/sandbox chain in this audit.
9. **Dependency risk:** Known high-severity advisories are present in production dependencies.
10. **Connected DB use in tests:** Without an explicit local-only guard, developer commands can contaminate operational data.

## 10. Recommended fix order

1. **Prevent unintended DB writes:** Fix E2E/readiness URL precedence and require `E2E_DATABASE_URL` local-host guard (BUG-006).
2. **Restore schema parity:** Deploy migration 0057 through the hardened deploy chain and verify 59/59 (BUG-001).
3. **Repair launch data:** Import/audit DC stock and product dimensions; establish a nonzero purchasable assortment (BUG-002).
4. **Restore communications:** Verify Resend domain and replay safe idempotent messages (BUG-004).
5. **Complete fiscal prerequisites:** Reject placeholders, configure BADI/PFR sandbox, and pass sale/refund acceptance (BUG-005).
6. **Recover Rabalux queue:** Classify/replay schema failures, resolve fetch/413 behavior, add operator tooling (BUG-003).
7. **Fix admin-to-storefront publication:** Trace and correct product eligibility/invalidation (BUG-007).
8. **Unify availability presentation:** SSR/API/hydrated PDP must use one result (BUG-008).
9. **Patch dependencies:** Upgrade high-severity vulnerable packages and rerun the full gate (BUG-009).
10. **Stabilize acceptance suites:** Update stale controls/selectors/provider branching and eliminate unexplained navigation noise (BUG-010).
11. **Make audit durable/atomic:** Transaction or outbox design for critical mutations (BUG-011).
12. **Finish operational onboarding:** Support/returns data and courier/payment/eOtpremnica acceptance (BUG-012).

## 11. Cleanup and data-safety statement

- A temporary tagged super-admin was created only to test the connected application and then deleted with its audit/rate-limit records.
- A misdirected article acceptance was stopped immediately after the DB-precedence defect was detected.
- Final connected-DB checks found zero remaining `codex.admin.audit.*`, `qa.*`, or `QA-ARTICLE-*` admin/product/supplier/category fixtures.
- Tagged Supabase upload fixtures were removed by test cleanup.
- All browser tabs, local Next servers, Playwright processes, and the isolated PostgreSQL container were stopped/removed.
- No repository source file was modified by this audit. This report is the only new artifact.

## 12. Final verdict

### Is every critical admin functionality working?

**NO**

### Is ERP integration reliable?

**NO**

Core local ERP transactions are substantially implemented, but the connected schema, supplier queue, launch catalog, fiscal/email integrations, and live courier/payment evidence are not reliable enough for production.

### Are there any P0 issues?

**NO**

### Are there any P1 issues?

**YES**

### Is there any functionality whose intended behavior is still unclear?

**YES**

The exact Rabalux threshold/label/automatic-availability policy, external ERP boundary, statutory registers, deferred marketing/content rules, and courier cancellation contract require answers.

# NOT APPROVED

Approval should be reconsidered only after the P1 order above is resolved, connected readiness passes, production dependencies are remediated or formally accepted, and the critical external sandbox chains have evidence-backed acceptance.
