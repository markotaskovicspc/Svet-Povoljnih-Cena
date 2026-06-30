# Full Production QA Audit Report

## 1. Executive Summary

The app is substantial and technically builds, but it is **not production-ready**. Storefront, catalog, search, product pages, cart, checkout, account, admin dashboard, API routes, payment flows, courier integrations, email, fiscalization, and feed scaffolding are present.

The main blockers are catalog/data quality, stock availability, expired campaign data, missing media, corrupted long descriptions, public payment/upload security gaps, incomplete production env setup, dependency advisories, and the absence of automated tests.

## 2. What Is Already Done

- Build, lint, and TypeScript checks pass from the main app at `/Users/luka/svet povoljnih cena`.
- Storefront routes, catalog/search, product pages, cart, checkout, account, admin dashboard, and API routes exist.
- Checkout reprices server-side, checks active products and stock, creates orders/items/payments/events, and decrements stock transactionally.
- Admin routes are session-gated, role-aware, and have audit logging helpers.
- Card payments are being moved to RaiAccept; old card-gateway runtime routes should stay removed.
- Public order confirmation uses hashed public access tokens instead of raw order lookup.

## 3. Checks Performed

- `npm run lint`: passed.
- `tsc --noEmit --incremental false`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev --audit-level=moderate`: failed with 13 advisories, including high-risk advisories for `next`, `hono`, and `fast-uri`.
- Product JSON/SQL/media helper syntax checks: passed.
- Not run: browser E2E, axe accessibility scan, Lighthouse, manual mobile QA, payment sandbox tests, courier sandbox tests.

## 4. What Is Still Missing

- Production env completion for DB, Supabase, Auth, RaiAccept, IPS, couriers, email, Viber, fiscalization, feeds, and supplier imports.
- Store owner-provided current inventory/catalog availability values, current promo dates, complete media folders, and clean long descriptions.
- Automated unit, integration, E2E, payment callback, admin auth, accessibility, and performance tests.
- Rate limiting, bot protection, abuse monitoring, and production observability.
- Final validation of payment, courier, email, fiscalization, and feed flows in staging.

## 5. Bugs And Technical Problems

| Issue | Severity / priority / launch blocker | Area | What is wrong and why it matters | Fix |
|---|---:|---|---|---|
| Imported catalog has zero stock | Critical / P0 / Yes | `outputs/Svet_akcija_supabase_import.sql`, `src/lib/api/checkout.ts`, `src/components/cart/add-to-cart-action.tsx` | Products import as active with `stock = 0`; users can add them, then checkout rejects. The store owner must provide real stock/catalog availability values; the developer should not invent these numbers. | Support importing owner-provided stock values, validate missing/zero stock, hide or disable unavailable products, and disable add-to-cart when stock is 0. |
| Promo campaign is expired | Critical / P0 / Yes | `outputs/Svet_akcija_supabase_import.sql` | Current date is 2026-06-30, but imported campaign is May 2026. Sale pricing and PDP messaging are stale. | Import current campaign data or deactivate expired sale prices/action IDs. |
| Missing product assets and data | Critical / P0 / Yes | `outputs/CLIENT_MISSING_ASSETS_AND_MISMATCHES.md` | 93 product folders are missing; many products lack brand/color/barcode/logistics data. This hurts trust, SEO, filtering, and operations. | Get missing assets or hide affected SKUs; block import rows that fail required data quality rules. |
| Long descriptions contain Git LFS pointer text | Critical / P0 / Yes | `outputs/svet-akcija-products.json` | 69 long descriptions contain LFS pointer metadata instead of real content, which can show broken text to customers and search engines. | Fetch real LFS files before extraction; reject pointer text during import and fall back to safe copy. |
| Payment start/status endpoints are public by order number/id | Critical / P0 / Yes | `src/app/api/payment/ips/start/[orderId]/route.ts`, `src/app/api/payment/raiaccept/start/[orderId]/route.ts`, `src/app/api/payment/ips/status/[orderId]/route.ts` | Anyone who knows or guesses an order ID/number can start or inspect payment state. | Require logged-in owner or valid public order token; use tokenized payment links for guests. |
| Public reclamation upload presign is abusable | Critical / P0 / Yes | `src/app/api/reclamations/upload/route.ts`, `src/lib/api/uploads.ts` | Unauthenticated users can request signed uploads for arbitrary content types. This risks storage abuse and public file hosting. | Require order/customer proof, strict image MIME/extension allow-list, private bucket keys, size limits, and rate limits. |

## 6. Security Problems

| Issue | Severity / priority / launch blocker | Area | What is wrong and why it matters | Fix |
|---|---:|---|---|---|
| IPS callback has no visible cryptographic verification | High / P0 / Yes until proven safe | `src/app/api/payment/ips/callback/route.ts`, `src/lib/payments/ips.ts` | A posted successful response can mark payment/order paid if the provider layer is reachable. | Implement provider signature/shared-secret validation, replay protection, and allowlisting per IPS docs. |
| Unsanitized HTML rendering on PDP | High / P1 / Yes | `src/components/product/pdp-info-links.tsx` | Product/admin/imported HTML is rendered with `dangerouslySetInnerHTML`, creating XSS risk. | Sanitize with a strict allow-list or render markdown/plain text only. |
| Database TLS disables certificate verification | High / P1 / Yes | `src/lib/db.ts` | `sslmode=no-verify` weakens DB transport security. | Use verified TLS/CA or provider-approved verified connection mode. |
| Dangerous OAuth account linking | High / P1 / Yes | `src/lib/auth/auth.ts` | `allowDangerousEmailAccountLinking` can link accounts by email in risky provider scenarios. | Disable it or require explicit verified-email account linking. |
| No visible rate limiting | High / P1 / Yes | Login, admin login, reset, checkout, upload, voucher, newsletter, search | Brute force, spam, enumeration, and resource abuse are not controlled. | Add centralized IP plus identity rate limits and stronger admin lockout/alerting. |
| Newsletter unsubscribe by email only | Medium / P2 / No | `src/app/api/newsletter/route.ts` | Anyone can unsubscribe someone else if they know the email. | Require signed unsubscribe token or authenticated owner. |
| Cron secrets accepted in query string | Medium / P2 / No | Cron API routes | Secrets in URLs can leak through logs, proxies, and browser history. | Accept only `Authorization` headers. |
| Dependency advisories | High / P0 / Yes | `package.json`, lockfile | `npm audit` reports high-risk advisories in runtime dependencies. | Upgrade Next and affected packages, then rebuild and regression test. |

## 7. UX/UI Problems

- Add-to-cart does not clearly respect out-of-stock state, causing users to fail late at checkout.
- Expired promo dates and incomplete product data reduce customer trust.
- Missing product media makes listings and product detail pages feel unfinished.
- Order confirmation/email copy should not imply email delivery if email sending is fire-and-forget or provider env is missing.
- Admin layout appears desktop-first; mobile usability needs manual verification.

## 8. Accessibility Problems

- Positive: many forms use labels, `aria-invalid`, live error regions, dialog titles, and image alt text.
- Not verified: keyboard-only checkout, dialogs, mobile sticky bars, color contrast, focus visibility, and screen reader flow.
- Risk: imported rich HTML may create invalid heading/list/link structure or inaccessible content.

## 9. Performance Problems

- `images.unoptimized: true` and broad remote image patterns increase performance and security risk.
- Product listing queries map all product images instead of only the card image, which will scale poorly.
- Search is acceptable for the current catalog size but needs database indexing and monitoring before a larger catalog.
- Lighthouse/Core Web Vitals were not run.

## 10. Code Quality Problems

- Several comments still describe mocked/future behavior where real behavior now exists, which can mislead maintainers.
- Some integrations are scaffolded but incomplete, including X Express final shipment/check-address behavior due missing docs.
- Voucher usage limits and order number generation have race-condition risk under concurrent checkout.
- Supplier credentials are modeled as DB fields, which is risky unless encrypted or moved to a secret manager.
- API routes sometimes mask backend failures as empty successful responses, hiding production incidents.

## 11. Testing Gaps

- No test script or meaningful automated test suite was found.
- Add unit tests for pricing, stock, vouchers, order numbers, payment signature verification, upload validation, and auth guards.
- Add integration tests for checkout, payment callbacks, account addresses, admin authorization, reclamations, newsletter, and cron auth.
- Add E2E tests for guest checkout, logged-in checkout, failed payment, order confirmation token, out-of-stock cart, admin login, and mobile checkout.
- Add axe accessibility tests and Lighthouse budget checks in CI.

## 12. Production Readiness Score

**4/10.**

The codebase has a real foundation and passes build/type/lint, but the current data, security posture, integrations, dependency state, and test coverage are not safe for production checkout traffic.

## 13. Launch Blockers

- Fix stock/import availability by requiring store owner-provided stock/catalog values, then implement validation and disable add-to-cart for unavailable products.
- Replace expired campaign data and remove stale sale pricing.
- Resolve missing assets, corrupted LFS descriptions, and required product data gaps.
- Secure payment start/status/callback flows with owner/token checks and provider verification.
- Lock down reclamation uploads and reclamation ownership proof.
- Upgrade vulnerable dependencies and retest.
- Complete production env variables and run payment/courier/email/fiscalization staging tests.
- Add minimum smoke/E2E tests for checkout, payment, admin auth, and order confirmation.

## 14. Recommended Fix Order

### Fix first

- Store owner-provided catalog availability data readiness.
- Developer-side stock validation and unavailable-product behavior.
- Expired promos.
- Missing media.
- LFS descriptions.
- Payment endpoint authorization.
- Upload authorization.
- Dependency upgrades.
- Env completion.

### Fix second

- IPS callback verification.
- Rate limiting.
- Admin session revalidation.
- OAuth linking.
- DB TLS.
- Cron secrets.
- Newsletter unsubscribe.
- XSS sanitization.

### Fix third

- Voucher/order concurrency.
- DB constraints/RLS review.
- API error handling.
- Test suite.
- CI checks.
- Staging integration tests.

### Improve later

- Mobile/admin UX polish.
- Accessibility remediation from axe/manual QA.
- Image optimization.
- Search/index tuning.
- Monitoring dashboards.
- Final SEO cleanup.

## 15. Final Recommendation

Do **not** launch this app publicly yet, especially not with paid traffic or real payment processing. It is closer to a serious pre-production build than a finished store.

The next implementation group should be the **P0 launch blockers**: catalog readiness, payment/upload security, dependency upgrades, and env hardening.

## 16. Phase-by-phase implementation plan

Use this section to fix the project one phase at a time. Each phase is split into smaller subphases so work can be reviewed, tested, and committed safely.

### Phase 1: Separate store-owner tasks from developer tasks

#### Phase 1.1: Store owner data responsibility

Store owner must provide or confirm:

- Real stock/catalog availability values for every product.
- Current active promotion dates.
- Correct sale prices and regular prices.
- Missing product photos, folders, and media files.
- Correct product names, brands, colors, barcodes, SKUs, dimensions, weights, and logistics data.
- Real product descriptions instead of Git LFS pointer files or broken placeholder text.
- Business content: shipping rules, return/reclamation rules, privacy policy, terms, contact details, fiscal/company details.

#### Phase 1.2: Developer responsibility

Developer must implement:

- Import support for owner-provided stock/catalog values.
- Validation that blocks or reports missing stock, broken descriptions, missing required media, and invalid product data.
- Storefront behavior for unavailable products: disabled add-to-cart, clear out-of-stock message, and no late checkout failure.
- Admin/reporting tools so the owner can see which products are missing required data.

### Phase 2: Catalog and storefront launch blockers

#### Phase 2.1: Stock and availability

- Update import logic so stock/catalog availability comes from store owner data.
- Treat missing stock as unavailable by default.
- Disable add-to-cart on PDP and product cards when product is unavailable.
- Keep server-side checkout stock validation as the final authority.

#### Phase 2.2: Campaign and pricing

- Remove or deactivate expired May 2026 promo data.
- Import only current owner-approved campaigns.
- Add validation that warns when campaign dates are expired before import.
- Confirm product cards, PDPs, cart, and checkout all show the same price.

#### Phase 2.3: Media and descriptions

- Block or report products with missing required images.
- Replace Git LFS pointer descriptions with real extracted descriptions.
- Add fallback copy only when the owner has approved it.
- Make the missing-assets report easy for the owner to review.

### Phase 3: Payment, upload, and security hardening

#### Phase 3.1: Payment access control

- Require logged-in owner match or valid public order token before starting or checking payment status.
- Use tokenized guest payment URLs.
- Hide raw gateway errors from public responses.

#### Phase 3.2: IPS/RaiAccept verification

- Confirm IPS provider documentation and implement required signature/shared-secret verification.
- Add replay protection for callbacks.
- Implement RaiAccept return/webhook verification from the Raiffeisen contract and add tests around success/failure cases.

#### Phase 3.3: Upload and reclamation security

- Require order/customer proof before allowing reclamation uploads.
- Allow only approved image MIME types and extensions.
- Store uploads under controlled private/object-scoped paths.
- Reject arbitrary external photo URLs in reclamations.

### Phase 4: App-wide security and production configuration

#### Phase 4.1: Authentication and abuse protection

- Add rate limiting to admin login, customer login, password reset, checkout, voucher validation, newsletter, search, upload, and reclamation endpoints.
- Recheck admin user status/role from DB for sensitive admin access.
- Disable risky OAuth email account linking unless explicitly required and verified.

#### Phase 4.2: Secrets and environment variables

- Complete all required production env variables.
- Move secrets out of DB fields where possible or encrypt them at rest.
- Remove cron secrets from query strings and require authorization headers.
- Replace DB `sslmode=no-verify` with verified TLS configuration.

#### Phase 4.3: Dependency and framework updates

- Upgrade vulnerable dependencies reported by `npm audit`.
- Upgrade Next carefully and read the local Next docs before code changes, because this project uses a changed Next version.
- Re-run lint, typecheck, build, and smoke tests after each dependency group.

### Phase 5: Correctness, race conditions, and API reliability

#### Phase 5.1: Checkout correctness

- Fix voucher usage race conditions.
- Add safe retry or database sequence behavior for order numbers.
- Confirm duplicate checkout clicks cannot create bad payment/order state.

#### Phase 5.2: API reliability

- Stop returning fake-success empty results for backend failures where the frontend needs to know the system failed.
- Add consistent error responses and server logging.
- Add monitoring for checkout, payment, import, and email failures.

### Phase 6: Testing and production readiness

#### Phase 6.1: Automated tests

- Add unit tests for pricing, stock, vouchers, order numbers, uploads, payment verification, and auth guards.
- Add integration tests for checkout, payment callbacks, account addresses, admin auth, newsletter, reclamations, and cron auth.
- Add E2E tests for guest checkout, logged-in checkout, failed payment, out-of-stock cart, order confirmation, admin login, and mobile checkout.

#### Phase 6.2: Manual QA and launch checks

- Run full mobile checkout QA.
- Run keyboard-only and screen reader accessibility checks.
- Run Lighthouse/Core Web Vitals checks.
- Run payment, email, courier, fiscalization, and feed tests in staging.
- Launch only after P0 and P1 issues are resolved and staging checkout is verified end to end.

## 17. Poruka za vlasnika prodavnice

Ovo je jednostavno objašnjenje koje može da se pošalje vlasniku prodavnice.

---

Zdravo,

uradio sam tehničku proveru aplikacije. Aplikacija ima dobru osnovu, ali još nije spremna za javno puštanje dok se ne srede podaci o proizvodima i neke tehničke zaštite.

Važno je da razdvojimo šta je posao vlasnika prodavnice, a šta je posao developera.

### Šta treba da obezbedi vlasnik prodavnice

- Tačan lager, odnosno koliko komada ima za svaki proizvod.
- Informaciju koji proizvodi smeju da budu aktivni na sajtu, a koji nisu dostupni.
- Aktuelne akcije i tačne datume trajanja akcija.
- Tačne redovne i akcijske cene.
- Sve slike proizvoda koje nedostaju.
- Tačne nazive proizvoda, brendove, boje, bar-kodove, SKU šifre, dimenzije i težine.
- Ispravne opise proizvoda.
- Pravila dostave, reklamacija, povraćaja robe, uslove korišćenja i politiku privatnosti.
- Podatke firme, kontakt podatke i sve potrebne podatke za fiskalizaciju, kurirske službe, plaćanje i slanje mejlova.

### Šta ne treba da radi developer

Developer ne treba da izmišlja lager, cene, akcije, slike, opise, bar-kodove ili poslovna pravila. To mora da dođe od prodavnice, jer su to poslovni podaci.

### Šta će uraditi developer

- Napraviće da se podaci koje prodavnica dostavi pravilno uvoze u sistem.
- Dodaće proveru da se ne objave proizvodi bez važnih podataka.
- Dodaće jasnu poruku kada proizvod nije dostupan.
- Onemogućiće dodavanje u korpu za proizvode koji nisu na lageru.
- Srediće tehničke bezbednosne probleme oko plaćanja, upload-a fajlova, korisničkih naloga i admin panela.
- Dodaće testove da se proveri checkout, plaćanje, admin, porudžbine i osnovni tok kupovine.

### Zaključak

Sajt ne treba javno pustiti dok se ne dostave tačni podaci o proizvodima, lageru, slikama, cenama i akcijama, i dok se ne završe tehničke bezbednosne ispravke.

Najbrži put do lansiranja je:

1. Vlasnik prodavnice dostavlja ispravne podatke.
2. Developer sređuje import, validaciju i zaštite.
3. Sve se testira na staging okruženju.
4. Tek onda se sajt pušta javno.
