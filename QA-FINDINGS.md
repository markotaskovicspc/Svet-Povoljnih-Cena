# QA Findings — Svet Povoljnih Cena

## Phase 1 — Static checks, environment, database
**Model used:** Sonnet 4.6
**Date:** 2026-07-01

### 1. Static checks

| Command | Result |
|---|---|
| `npm run lint` | ✅ PASS — clean, no warnings/errors |
| `./node_modules/.bin/tsc --noEmit --pretty false` | ✅ PASS — no type errors |
| `npm run build` (`next build`, Turbopack) | ✅ PASS — compiled in 3.7s, TS in 5.4s, all 38 static pages generated, all app routes (storefront/admin/api/cron) built successfully |

No lint/type/build issues found. Nothing to fix inline for this section.

### 2. Env audit

- `.env.local` has 157 vars vs 132 named in `.env.example`. Diff is additive only (no vars removed) — extras in `.env.local` not in `.env.example`: `AUTH_APPLE_ID/SECRET`, `AUTH_FACEBOOK_ID/SECRET`, `AUTH_GOOGLE_ID/SECRET`, `ENABLE_STATIC_CATALOG_FALLBACK`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_RECLAMATION_UPLOAD_BUCKET`, `ORDER_ACCESS_TOKEN_SECRET`, `PAYMENT_PENDING_EXPIRY_MINUTES`, `POSTGRES_DATABASE/HOST/PASSWORD/USER`, `PYTHON`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_RECEIPT_BUCKET`, `SUPABASE_RECLAMATION_UPLOAD_BUCKET`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_URL`, `X_EXPRESS_LOCATIONS_PATH`. All benign (Supabase/OAuth provisioning vars, not referenced as missing-critical).
- `X_EXPRESS_WEBHOOK_API_KEY` and `X_EXPRESS_WEBHOOK_SECRET` values confirmed **byte-for-byte identical** (lengths match, direct string comparison confirms equality). Code treats them as interchangeable auth methods (`x-api-key` header vs `Bearer`) — worth deduplicating to a single secret in a future cleanup, but not a functional bug since webhook auth accepts either.
- `NEXTAUTH_SECRET=$AUTH_SECRET` expansion: confirmed as documented Next.js behavior (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` — "Next.js will automatically expand variables that use `$` to reference other variables"). `npm run build` succeeded, confirming the expansion resolves correctly at build/runtime.
- `DATABASE_URL` is empty as expected; app falls back to `POSTGRES_PRISMA_URL` (confirmed working, see below).

### 3. Database state

- **`prisma migrate status` initially hung indefinitely (~10+ min, no output) against the pooler connection string** (`POSTGRES_PRISMA_URL`, port 6543, `pgbouncer=true`). Root-caused: Prisma's Rust migration engine performs full TLS cert-chain verification (libpq `sslmode=require` is aliased to `verify-full` by newer pg tooling) and the Supabase pooler's Postgres-protocol TLS on port 6543 presents a cert that isn't validating cleanly for the Rust engine — even with `NODE_TLS_REJECT_UNAUTHORIZED=0` set (the Rust binary doesn't respect Node's TLS env vars, so this had no effect and it hung again).
  - **Workaround found:** running `prisma migrate status`/`migrate deploy` with `DATABASE_URL` explicitly set to `POSTGRES_URL_NON_POOLING` (direct connection, port 5432) works instantly. This matches Supabase's own recommendation to use the direct connection (not the pooler) for migrations.
  - **Result: schema is already up to date — migration `0013_erp_phase2_masterdata` is already applied.** All 15 migrations present and applied. The plan's premise of a "pending migration" is stale; no `db:deploy` action was needed.
  - **This is CLI-only — the running app is unaffected.** `src/lib/db.ts` uses `@prisma/adapter-pg` (the `pg` npm driver, not the Rust query engine) for all runtime queries, and its `withDatabaseSsl()` helper already adds `uselibpqcompat=true` to the connection string, which reverts to standard libpq `require` semantics (encrypt, don't fully verify chain) instead of `verify-full`. Verified directly: a raw `pg` connection using the app's exact SSL-fixup logic against `POSTGRES_PRISMA_URL` connects and queries successfully in ~1s.
  - **Recommendation (dev workflow, not a code bug):** when running `prisma migrate` commands locally/in CI, set `DATABASE_URL` to the non-pooling URL, since the CLI's migration engine doesn't apply the same `uselibpqcompat` fixup that `prisma.config.ts`/`src/lib/db.ts` apply for the app. Not fixed inline — this is a local dev-tooling nuance, not an app bug, and touches migration tooling which the fix policy scopes as report-only-adjacent (no risk to fix, but out of scope for "small inline bugs").
- **DB connectivity confirmed** via throwaway read-only script (`pg` client, same SSL fixup as the app):
  - Product count: 209
  - Order count: 0
  - AdminUser count: 2 (both role `SUPER`, emails masked: `ad***@svetpovoljnihcena.rs`, `ad***@spc.local`)
- **Admin user check:** 2 SUPER admin users already exist. `scripts/create-admin.mjs` was **not** run (not needed — idempotent upsert only needed when none exist).

### Changes made
None — all static checks passed clean, no fixes needed this phase.

### Blocked / carried forward
None new. Migration 0013 confirmed already applied (contradicts stale plan assumption — noted above, not a blocker).

### State for next phase
- Dev server: not started yet.
- `COURIER_SMALL_PROVIDER`: not yet checked this session — plan expects it to start as `"MYGLS"` for Phase 2.
- No QA test orders created yet.
- No cleanup obligations yet (no shipments/labels/orders created).

## Phase 2 — Storefront, auth, checkout
**Model used:** Sonnet 4.6
**Date:** 2026-07-02

### 1. Storefront navigation, search, cart
✅ PASS — navigation, product search, cart add/update/remove all verified working in the browser preview.

### 2. Customer auth
✅ PASS — register, login, logout, session persistence, and protected-route redirect all verified working.

### 3. Bugs found and fixed

**Bug #1 (fixed): desktop header didn't reflect login state**
- [src/components/layout/header.tsx](src/components/layout/header.tsx) — the desktop header always rendered "Prijava" regardless of auth state. The mobile nav already branched on login state; the desktop header didn't.
- Fix: branch desktop header on `isCustomerLoggedIn` prop, same as mobile. Verified in browser.

**Bug #2 (fixed, critical — checkout blocker): step transition hang after identity confirmation**
- [src/components/checkout/checkout-flow.tsx](src/components/checkout/checkout-flow.tsx) — `AnimatePresence mode="wait"` around checkout step transitions would hang (seconds to indefinitely) after confirming identity, leaving the shipping-address form blank. Full checkout blocker.
- Reproduced on both `next dev` and a fresh production build (`next build && next start`). Root cause looks like a Framer Motion / React-19-canary interaction — this Next.js version bundles a React canary (see `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`).
- Fix: removed `mode="wait"` from that `AnimatePresence`. Verified reliable (sub-1s transitions) across 5 repeated tests on both dev and prod builds. Minor cosmetic trade-off: a brief crossfade "ghosting" between steps now shows — acceptable.

### 4. Bugs found, NOT fixed (need product/ops decisions — flagging, not patching)

**Bug #3: `order-receipts` Supabase storage bucket does not exist**
- Every order creation logs `[receipt] upload failed StorageApiError: Bucket not found` ([src/lib/receipts/buyer.ts:48](src/lib/receipts/buyer.ts#L48)).
- Root cause confirmed via direct Supabase Storage API call (`GET /storage/v1/bucket`): the project has `product-media`, `shipment-labels`, `reclamation-uploads` — no `order-receipts`. `SUPABASE_RECEIPT_BUCKET=order-receipts` in `.env.local` matches the code's default, so config is correct; the bucket itself was simply never created in Supabase.
- Impact: contained — `uploadReceiptPdf` failure is caught and swallowed (returns `null`), so checkout is not blocked and the Invoice row is still created with `pdfUrl: null`. But no buyer receipt PDF is ever available/linked.
- Not fixed inline: this is infra provisioning (create the bucket in the Supabase dashboard/via API), not an app code bug.

**Bug #4: order confirmation emails silently fail — `EMAIL_PROVIDER=resend` with a placeholder API key**
- `.env.local` has `EMAIL_PROVIDER=resend` but `RESEND_API_KEY=GET_FROM_RESEND_API_KEYS` (unfilled placeholder). This is **not** the dev/console-log mode the QA plan assumed — the app treats any non-empty `RESEND_API_KEY` as configured and calls the real Resend API, which returns 401.
- Confirmed via DB: the invoice row for QA order SPC-2026-000001 shows `status: "EMAIL_FAILED"`, `emailError: "resend:401 API key is invalid"`.
- Impact: contained to that one async side-effect (checkout itself isn't blocked, this is fire-and-forget per [src/lib/api/checkout.ts:686-695](src/lib/api/checkout.ts#L686-L695)) — but no order-confirmation email is actually sent or even logged locally, which could easily be missed since nothing about it surfaces to the customer or in the checkout UI.
- Fix options (product/ops decision, not made here): either set `EMAIL_PROVIDER=none` for this environment so emails log via `[email:dev]` instead of hitting a real (broken) provider, or fill in a real `RESEND_API_KEY`.

**Bug #5: IPS payment start crashes with an uncaught 500 instead of the intended graceful error page**
- [src/lib/payments/ips.ts](src/lib/payments/ips.ts) `getIpsConfig()` only checks that `IPS_BASE_URL` / `IPS_USER_ID` / `IPS_TID` are *present* (truthy), not that they're valid. `.env.local` has them set to unfilled placeholders (`IPS_BASE_URL=GET_FROM_RAIFFEISEN_IPS_DOCS`, etc.), which pass the presence check.
- `createPayment` then calls `fetch()` with that placeholder as a base URL, which throws `TypeError: Failed to parse URL from GET_FROM_RAIFFEISEN_IPS_DOCS/...` (`ERR_INVALID_URL`). This TypeError isn't an `IpsConfigError` or `IpsGatewayError`, so [src/app/api/payment/ips/start/[orderId]/route.ts:78-90](src/app/api/payment/ips/start/%5BorderId%5D/route.ts#L78-L90) doesn't catch it — it propagates to a raw Next.js 500, not the "IPS plaćanje trenutno nije moguće" page the code clearly intended for this exact scenario.
- No real external network call is made (the URL fails to parse before any request is sent), so this is a UX/error-handling bug, not a security or data-integrity issue.
- Reproduced directly: order SPC-2026-000002 (paymentMethod IPS) → `GET /api/payment/ips/start/SPC-2026-000002?token=...` → `500`, confirmed in server logs (`ERR_INVALID_URL` at `ips.ts:331`).
- Suggested fix (not applied): validate `new URL(baseUrl)` inside `getIpsConfig()` and throw `IpsConfigError` if it doesn't parse, so placeholder/malformed values are caught the same way missing values already are.

**Bug #6: `KARTICA` (card) payment method is enabled in the DB despite the gateway being unconfigured, contradicting its own seeded note**
- `PaymentMethodConfig` DB row: `{ method: "KARTICA", enabled: true, note: "Kartično plaćanje aktivira se nakon WSPay/Raiffeisen podešavanja." }` — the note says card payment should activate *after* WSPay/Raiffeisen setup is complete, but `enabled` is already `true`.
- Unlike IPS, the card flow ([src/app/api/payment/raiaccept/start/[orderId]/route.ts](src/app/api/payment/raiaccept/start/%5BorderId%5D/route.ts)) handles this correctly: `requireRaiAcceptConfigured()` throws `RaiAcceptConfigError`, which is caught and returns a clean `503` with the friendly message "RaiAccept kartično plaćanje nije konfigurisano...". Verified — no external call made, logged via `logOperationalError`.
- So the checkout *flow itself* doesn't break, but customers can currently select "Kartica" at checkout and only discover it doesn't work after being redirected to a dead-end error page. Not a code bug — a data-seeding oversight in `PaymentMethodConfig`. Recommend setting `enabled: false` for `KARTICA` until WSPay/Raiffeisen is actually wired up.

### 5. Performance observations
- Order creation (`POST /api/checkout/order`) took **10.5s** server-side in one measurement — explains an earlier false alarm where the post-order redirect to `/checkout/potvrda` looked "stuck" (it wasn't a router bug, the fetch itself was slow). The confirmation page loads fine directly. The slow path isn't the receipt/email side-effect (that's fire-and-forget, [src/lib/api/checkout.ts:683-696](src/lib/api/checkout.ts#L683-L696)), so the latency is somewhere else in `createOrder` — not root-caused this phase, flagging for follow-up.
- Homepage (`GET /`) took up to 10-41s on first requests after a fresh dev-server start, settling to ~2-3s on subsequent requests. This tracks as normal Turbopack cold-compile-on-first-request dev-mode behavior, not a product bug — `npm run build` already confirmed a clean production build in Phase 1.

### 6. QA test orders created (need cleanup in Phase 5 — cancel to restore stock)
All placed against `relax-1133` (the only in-stock product used for cart/checkout testing throughout Phase 2):
| Order | Payment method | Path | Notes |
|---|---|---|---|
| SPC-2026-000001 | POUZECE_GOTOVINA (COD) | Full guest checkout via UI | Successful end-to-end order. Stock 9→8. Invoice EMAIL_FAILED (bug #4), receipt bucket missing (bug #3). |
| SPC-2026-000002 | IPS | Direct API call (`POST /api/checkout/order`) | Order created fine; payment-start crashed 500 (bug #5). Stock 8→7. |
| SPC-2026-000003 | KARTICA | Direct API call (`POST /api/checkout/order`) | Order created fine; payment-start failed cleanly 503 (verifies bug #6 doesn't break the flow). Stock 7→6. |

### 7. Environment notes carried forward
- `COURIER_SMALL_PROVIDER="MYGLS"` in `.env.local` — confirmed correct, unchanged.
- A stray dev server from a prior/parallel session on port 3000 was found stopped mid-session (its process had exited); a fresh dev server was started for this session's testing (serverId `165a4200-81da-4d61-a8af-86ecd31b82b8`). `.claude/launch.json` `autoPort` was flipped to `true` to unblock startup — should be safe to leave or revert, doesn't affect app behavior.

### Changes made
- [src/components/layout/header.tsx](src/components/layout/header.tsx) — fixed desktop login-state display (bug #1).
- [src/components/checkout/checkout-flow.tsx](src/components/checkout/checkout-flow.tsx) — removed `AnimatePresence mode="wait"` causing checkout hang (bug #2).
- Both uncommitted — no commits made this phase (none requested).

### Blocked / carried forward
- Bugs #3–#6 documented above, not fixed inline (infra/config/product decisions, not simple code bugs).
- Performance root cause for the 10.5s order-creation latency not yet investigated.

### State for next phase
- Dev server running on port 3000 (serverId `165a4200-81da-4d61-a8af-86ecd31b82b8`).
- 3 QA test orders (SPC-2026-000001/2/3) exist and must be cancelled in Phase 5 to restore `relax-1133` stock (currently 6, should return to 9).
- `src/components/checkout/checkout-flow.tsx` and `src/components/layout/header.tsx` have uncommitted fixes carried into Phase 3/4/5.

## Phase 3 — Admin panel full sweep + security
**Model used:** Sonnet 4.6 (including the security sub-section — no model switch was performed; findings below were double-checked carefully given that)
**Date:** 2026-07-02

### 0. Setup
- Found the Phase 2 dev server still running on port 3000 as a stray orphaned process (PID 79827, cold — first request took ~15s). Killed it and started a fresh tracked server via `preview_start` (serverId `fb2b6693-78d2-4201-aeb3-39982b745705`). Same port 3000.
- Created two dedicated QA admin accounts via the idempotent `scripts/create-admin.mjs` (does **not** touch the 2 existing production admins):
  - `qa-admin-test@svetpovoljnihcena.local` / role SUPER — used for the main sweep.
  - `qa-admin-content@svetpovoljnihcena.local` / role CONTENT — used only for the RBAC negative test in the security section.
  - Both are harmless to leave in the DB (no PII, clearly QA-marked emails) but are flagged here for awareness; not deleted this phase since Phase 4/5 admin work will keep using the SUPER one.

### 1. Auth
| Check | Result |
|---|---|
| `/admin` unauthenticated | ✅ 307 → `/admin/prijava?callbackUrl=%2Fadmin` |
| `/admin/narudzbine` unauthenticated | ✅ 307 → `/admin/prijava?callbackUrl=...` |
| Wrong credentials | ✅ Generic "Pogrešna e-pošta ili lozinka." — does not reveal whether the email exists |
| Rate limiting | ✅ Confirmed empirically: 7 rapid POSTs to `/api/auth/callback/admin-credentials` with the same wrong email — server logs show exactly 5 `[admin-credentials] admin lookup` DB round-trips (~170–1300ms each), then attempts 6–7 short-circuit in ~10ms with no DB hit. Matches `RATE_LIMITS.adminLogin = { limit: 5, windowMs: 15min }` in `src/lib/security/rate-limit.ts`. The rate-limited path is indistinguishable from a wrong-password response to the client (both return the same generic error) — good, no timing/enumeration oracle. |
| Valid login | ✅ Redirects to `/admin/erp`, header shows "Prijavljen kao QA TEST · Super admin" |
| Session persistence across reload | ✅ Confirmed |
| Logout | ✅ Client redirect to `/admin/prijava`; confirmed server-side via `curl /admin` → 307 post-logout (session actually cleared, not just client-side) |

### 2. Route sweep — all 27 admin routes
Swept via authenticated same-origin `fetch()` for HTTP status + rendered `<h1>` + error-text scan, then spot-checked kontrolna tabla / izvestaji / dostava by real browser navigation for console/network errors.

| Route | Status | Notes |
|---|---|---|
| `/admin` (kontrolna tabla) | ✅ 200 | |
| `/admin/akcije` | ✅ 200 | |
| `/admin/audit-log` | ✅ 200 | |
| `/admin/baneri` | ✅ 200 | |
| `/admin/checkouti` | ✅ 200 | |
| `/admin/dostava` | ✅ 200 | |
| `/admin/erp` | ✅ 200 | |
| `/admin/fiskalizacija` | ✅ 200 | |
| `/admin/heroji` | ✅ 200 | |
| `/admin/izvestaji` | ✅ 200 | |
| `/admin/kategorije` | ✅ 200 | **~2MB response** — see Bug #7 below |
| `/admin/komentari` | ✅ 200 | |
| `/admin/narudzbine` | ✅ 200 | |
| `/admin/newsletter` | ✅ 200 | |
| `/admin/oglasi` | ✅ 200 | ~815KB response (100 products × 3 per-cell forms; bounded by `take: 100`, not unbounded like kategorije) |
| `/admin/piktogrami` | ✅ 200 | |
| `/admin/placanje` | ✅ 200 | |
| `/admin/pocetna` | ✅ 200 | |
| `/admin/preporuke` | ✅ 200 | |
| `/admin/proizvodi` | ✅ 200 | |
| `/admin/promo-traka` | ✅ 200 | |
| `/admin/reklamacije` | ✅ 200 | empty state (0 reclamations) |
| `/admin/sadrzaj` | ✅ 200 | |
| `/admin/tabovi` | ✅ 200 | |
| `/admin/vauceri` | ✅ 200 | |
| `/admin/viber` | ✅ 200 | |
| `/admin/xml-import` | ✅ 200 | see note in section 5 |
| `/admin/erp/artikli` | ✅ 200 | **~1.6MB response** |
| `/admin/erp/dobavljaci` | ✅ 200 | |
| `/admin/erp/nabavne-cene` | ✅ 200 | |
| `/admin/erp/porudzbenice` | ✅ 200 | |
| `/admin/erp/porudzbenice-po-artiklima` | ✅ 200 | |
| `/admin/erp/ulazne-fakture` | ✅ 200 | |
| `/admin/erp/mp-cene` | ✅ 200 | **~860KB response** |

No console errors, no failed network requests, no "Application error"/500 markers on any route. All headings matched expected page content.

### 3. Orders
- List + search filter (`?q=000001`) + status filter (`?status=ISPORUCENO` → correct empty state with "Nema..." message) all work correctly.
- Opened QA order SPC-2026-000001 detail page — items, shipping address, status timeline, amounts, courier section, receipt section, fiscalization section all render.
- Status transitions KREIRANO → POTVRDJENO → U_PRIPREMI: all three now present in the `OrderStatusEvent` timeline in the correct order, and in the audit log (`order.statusUpdate`, actor QA TEST, correct diff, IP `::1`).
- Order-status-change emails: both attempts (`potvrđena`, `u pripremi`) correctly tracked in `EmailMessage` as `status: FAILED`, `provider: resend`, `error: "resend:401 API key is invalid"` — same root cause as Phase 2 bug #4 (placeholder `RESEND_API_KEY`), now confirmed to also affect status-change emails, not just order-confirmation. Not a new bug — extends the known one.

**Bug #7 (fixed): order status dropdown didn't reflect the new status after saving**
- [src/app/admin/narudzbine/[id]/page.tsx:475](src/app/admin/narudzbine/%5Bid%5D/page.tsx#L475) — the status `<select>` used `defaultValue={order.status}` with no `key`. React only applies `defaultValue` on mount; after the status-update server action revalidated the page, the mutation succeeded (confirmed server-side and via the timeline updating) but the dropdown kept showing the *pre-change* status until a manual hard reload. An admin could reasonably believe their save silently failed and retry.
- Fix: added `key={order.status}` to the `<select>` so React remounts it (and re-applies `defaultValue`) whenever the server-confirmed status changes. Verified: did a second live transition (POTVRDJENO → U_PRIPREMI) without reloading — dropdown now updates immediately to reflect the new value.
- Risk: low — one-line, standard React fix for this exact defaultValue-staleness pattern, no behavior change beyond fixing the display bug.

### 4. Products / content
- Product list (31 rows) loads; opened detail/edit page for "RELAX" — all sections render (Osnovni podaci, Kategorije, Piktogrami, Dobavljač, XML zaštita polja, Mediji).
- Product with **zero media** (`sa-prod-210027` / "X DESK", confirmed via DB query `media: { none: {} }`) renders cleanly — "Mediji (0)", no crash, no console error.
- Validation test: bypassed the client-side `min={0}` HTML constraint and submitted `fullPrice = -50` directly. Server correctly rejected it (`z.coerce.number().nonnegative()` in the Zod schema) — confirmed via direct DB read that `fullPrice` stayed at `10000`, no bad data persisted.

**Bug #8 (found, NOT fixed — needs a broader pattern fix, not a one-liner): rejected admin form submissions give zero user-facing feedback**
- The product-edit form ([src/app/admin/proizvodi/[id]/page.tsx:486](src/app/admin/proizvodi/%5Bid%5D/page.tsx#L486)) is a bare `<form action={updateProduct}>` — not wrapped in `AdminActionForm`/`useActionState` the way e.g. `/admin/oglasi` forms are. When the server action returns `{ ok: false, error }` (as it correctly does for the negative-price case above), that return value is discarded — there's no state hook consuming it. The page just silently re-renders with the old values and the admin gets **no error message, no indication anything happened**.
- Confirmed same bare-form pattern (and thus the same silent-failure risk) in `/admin/kategorije` (`src/app/admin/kategorije/page.tsx`) — likely present in other pages built the same way; a full audit of which admin forms use `AdminActionForm` vs. a bare `<form action={...}>` was not done this phase.
- Impact: **not a data-integrity issue** (validation correctly blocks bad data server-side) — it's a UX/trust issue. An admin who makes a genuine mistake (e.g., a typo that fails validation) has no way to know their edit didn't save.
- Not fixed inline: the correct fix is converting these forms to `useActionState` + surfacing `state.error`, matching the `AdminActionForm` pattern already used elsewhere — that's a component-level change best done consistently across all affected pages in one pass, not a per-page patch under this phase's "small inline fix" scope. Flagging for a follow-up task.

### 5. Reclamations, fiskalizacija, ERP, xml-import
- `/admin/reklamacije` — empty state, no reclamations yet, no errors.
- `/admin/fiskalizacija` — loads, filters render, "0 prikazanih redova" (expected, no fiscalized orders yet).
- All 7 ERP modules (`artikli`, `dobavljaci`, `nabavne-cene`, `porudzbenice`, `porudzbenice-po-artiklima`, `ulazne-fakture`, `mp-cene`) load with correct headings, no errors — confirms migration 0013 data model is fully functional post-migration (Phase 1 already confirmed 0013 applied).
- **`XML_SUPPLIERS` plan assumption is stale.** Grepped the codebase: this env var is not referenced anywhere in `src/`. The only related mechanism is a *per-supplier* secret-resolution fallback (`XML_SUPPLIER_<TOKEN>_USER`/`_PASS`, [src/lib/xml/import.ts:79](src/lib/xml/import.ts#L79)), used only when a `Supplier` row's `authUser`/`authPass` field is explicitly set to `env:XML_SUPPLIER_<ID>_USER`. The XML import admin page itself is entirely DB-driven — it already has 19 suppliers configured and rendered fine ("19 dobavljača · 1 skorih run-ova", supplier table, recent-imports table, "Novi dobavljač" creation form all present). There is no "missing config → readable error" state to test, because nothing on this page depends on that env var. **No imports were triggered**, per the plan's instruction.

### 6. Security sweep
| Check | Result |
|---|---|
| `POST /api/admin/erp/artikli/commands` (no session) | ✅ 307 redirect, 0 bytes body |
| `GET`/`PATCH /api/admin/erp/artikli/rows/test123` (no session) | ✅ 405 (GET not implemented) / 307 (PATCH, no session) |
| `GET /api/admin/invoices/test123/pdf` (no session) | ✅ 307, 0 bytes |
| `POST /api/admin/invoices/test123/resend` (no session) | ✅ 307, 0 bytes |
| `GET /api/admin/shipments/test123/label` (no session) | ✅ 307, 0 bytes |
| `GET /api/account/addresses` (no session) | ✅ 307, 0 bytes |
| `GET /api/cron/mygls/status-sync` (no bearer) | ✅ 401 `{"ok":false,"error":"unauthorized"}` |
| `GET /api/cron/mygls/master-data` (no bearer) | ✅ 401 |
| `GET /api/cron/x-express/status-sync` (no bearer) | ✅ 401 |
| `GET /api/cron/x-express/dictionaries` (no bearer) | ✅ 401 |
| `GET /api/cron/x-express/webhook-events` (no bearer) | ✅ 401 |
| `GET /api/cron/mygls/status-sync` with wrong bearer token | ✅ 401, same generic error (no info leak) |
| `POST /api/x-express/webhook` (no auth) | ✅ 401 (light touch here; full auth-matrix test is Phase 4 scope per plan) |
| Static file / secret leakage: `/.env`, `/.env.local`, `/prisma/schema.prisma`, `/package.json`, `/.git/config` | ✅ All 404 |
| Grep home page + checkout page HTML + all `src_*` JS chunks for `SECRET`/`API_KEY`/`PASSWORD`/`sk_live`/`sk_test`/connection strings | ✅ No matches |
| RBAC (negative test) | ✅ Created a second QA admin with role CONTENT. Confirmed: (a) sidebar nav is server-filtered — CONTENT admin's sidebar has no Narudžbine/Fiskalizacija/Checkouti/Reklamacije/XML feed/Audit log links at all; (b) direct navigation to `/admin/narudzbine` (OPS-only) as CONTENT → redirected to `/admin?forbidden=1` with "Nemate ovlašćenja za tu sekciju." shown; (c) same for the order detail page. The guard (`requireAdminAction(["OPS"])`) is the same function called both by the page and inside the server action itself, so the mutation path is equally protected, not just the page render. |

**Design observation (not a bug):** admin API routes under `/api/admin/*` respond to unauthenticated requests with a 307 redirect to `/admin/prijava` (via `redirect()` in `requireAdminAction`) rather than a JSON 401. This is unconventional for routes meant to be called via `fetch`/XHR, but it's not a security issue — no data or mutation is ever exposed, the redirect just isn't parsed as an error by a JS client expecting JSON. Worth a note for API consumers, not a fix.

### Changes made
- [src/app/admin/narudzbine/[id]/page.tsx](src/app/admin/narudzbine/%5Bid%5D/page.tsx) — added `key={order.status}` to the status `<select>` (Bug #7). Low risk.
- Uncommitted, along with the Phase 2 fixes.

### Blocked / carried forward
- Bug #8 (silent validation-failure UX across bare-form admin pages) — needs a broader pass, not fixed this phase.
- Kategorije O(N²) page-size growth (~2MB at 60 categories) and the large ERP `artikli`/`mp-cene`/`oglasi` pages — flagged as performance observations for the final report, not fixed (architectural, out of "small inline fix" scope).
- RESEND_API_KEY placeholder issue (Phase 2 bug #4) now confirmed to also affect order-status-change emails — same fix recommendation applies, nothing new to do.

### State for next phase
- Dev server running on port 3000 (serverId `fb2b6693-78d2-4201-aeb3-39982b745705`).
- `COURIER_SMALL_PROVIDER="MYGLS"` — unchanged, confirmed.
- 3 QA test orders (SPC-2026-000001/2/3) still exist, still need cancellation in Phase 5. SPC-2026-000001 status is now `U_PRIPREMI` (was `KREIRANO`) due to this phase's status-transition testing — Phase 5's cancel flow should handle this regardless of starting status, but noting the actual current status here in case that matters.
- Two QA admin accounts exist and can be reused/left as-is: `qa-admin-test@svetpovoljnihcena.local` (SUPER, password `QaTest12345678`) and `qa-admin-content@svetpovoljnihcena.local` (CONTENT, same password). Not flagged for mandatory cleanup (no PII, clearly QA-marked) but Phase 5 should decide whether to delete them.
- Uncommitted files carried forward: `src/components/checkout/checkout-flow.tsx`, `src/components/layout/header.tsx` (Phase 2), `src/app/admin/narudzbine/[id]/page.tsx` (Phase 3). No commits made.

## Phase 4 — Courier integrations: MyGLS pass, then X Express pass
**Model used:** Fable 5
**Date:** 2026-07-02

### 0. Setup
- Found the Phase 3 dev server still running on port 3000 as an untracked/orphaned process; used it in place for most of this phase, then killed it and started a fresh tracked server (serverId `1509e64a-91ad-461d-9f91-2fc98d50b943`) at the end once the env var was restored, to guarantee the new value was actually loaded (Next.js reads `.env.local` at process start).

### 1. Pass A — MyGLS (`COURIER_SMALL_PROVIDER="MYGLS"`, already active at phase start)

- **Config/URL construction**: verified correct — test base URL (`api.test.mygls.rs`), `ParcelService.svc/json/...` paths, SHA512 password hashing all match the docs.
- **Blocker (not fixable by us): MyGLS test-API credentials are invalid/expired.** Hit a real account lockout ("Too many failed login attempts... locked until 00:33") during testing; waited ~90s for it to clear. After the lockout cleared, the same credentials still returned `"Unauthorized."` on every call. This is a genuine bad-credential problem in `.env.local`, not a code bug — it blocks master-data sync, real PrintLabels success, status-sync, DeleteLabels, and ModifyCOD from ever succeeding against the real test API. **Report as a launch blocker**: new/valid MyGLS test (and eventually production) credentials are needed before this integration can be verified end-to-end.
- **Error paths verified working correctly despite the credential blocker**:
  - Ineligible order (unpaid prepaid) → throws a clean config error before any API call is made; no shipment row created; no crash.
  - Real API rejection (`Unauthorized.`) → a `FAILED` `Shipment` row is persisted with `syncError: "Unauthorized."`; no crash, no unhandled exception.
- **Note (checked, confirmed NOT a bug):** `CourierSyncRun.kind` enum only has `LOCATIONS` / `STATUSES` / `SHIPMENTS` — both the X Express delivery-points sync and the municipalities/towns/streets "locations" sync record their runs under the same `"LOCATIONS"` kind. This is a schema limitation (not enough granularity to distinguish sync sub-types), not a typo — confirmed by reading [prisma/schema.prisma:1277](prisma/schema.prisma#L1277) `CourierSyncKind` and the call sites. Not fixed (out of "small inline fix" scope; would need a schema migration to add sub-kinds).

**Bug #9 (found & fixed): MyGLS `PickupDate` sent in the wrong date format, breaking every shipment-create call before auth even ran**
- MyGLS's WCF JSON API requires the legacy `.NET` `/Date(milliseconds)/` string format for date fields, not ISO-8601. [src/lib/mygls/payload.ts](src/lib/mygls/payload.ts) was sending `PickupDate` as a plain ISO string, which the MyGLS server failed to deserialize — the request never even reached the auth/business-logic layer, so it looked like a mysterious blanket failure rather than a formatting bug.
- Fix: added `toMyGlsDate()` in [src/lib/mygls/config.ts:135](src/lib/mygls/config.ts#L135), used it in `serializeDate()` in [src/lib/mygls/client.ts:213](src/lib/mygls/client.ts#L213) (applies to any `Date` value serialized into a MyGLS payload) and in the `PickupDate` field in [src/lib/mygls/payload.ts:74](src/lib/mygls/payload.ts#L74).
- Verified: before the fix, shipment-create failed with a deserialization error; after the fix, the exact same call got past deserialization and failed with the expected `"Unauthorized."` instead — confirming the fix resolved the real problem and the only remaining blocker is the credential issue above.
- Risk: low — isolated date-formatting helper, used only in the MyGLS payload path, verified with a real before/after API call.

**Bug #10 (found, NOT fixed — extends Phase 3 Bug #8): admin courier-create buttons give zero UI feedback on failure**
- The admin "Kreiraj MyGLS nalog" / "Kreiraj X Express nalog" buttons on the order detail page use a bare `<form action={...}>` (calling a `withAdmin`-wrapped server action directly), not the `AdminActionForm`/`useActionState` pattern used elsewhere. When the action fails (as it correctly does here — audit-logged, `FAILED` shipment row persisted, no crash), the failure return value is discarded server-side and the admin sees **no error message and no visible change** without a manual hard reload.
- Additionally: `revalidatePath()` inside `createCourierShipment` ([src/app/admin/narudzbine/[id]/page.tsx](src/app/admin/narudzbine/%5Bid%5D/page.tsx)) is only called on the success path. So even the Next.js soft-navigation cache stays stale on failure — a hard reload is genuinely required to see the `FAILED` shipment row that was actually persisted.
- This is the same root pattern as Phase 3 Bug #8 (bare forms not surfacing server-action errors), now confirmed to also affect the courier-shipment-creation actions specifically. Not fixed inline — same reasoning as Bug #8: the correct fix is a consistent `AdminActionForm`/`useActionState` conversion pass, best done once across all affected admin pages, not per-page.

### 2. Pass B — X Express (`.env.local` temporarily set to `COURIER_SMALL_PROVIDER="X_EXPRESS"`, `X_EXPRESS_STATUS_PATH=""` kept empty, dev server restarted)

- **Config load**: correct.
- **Dictionaries sync** (`GET /api/cron/x-express/dictionaries` with bearer): ran successfully for municipalities (169 records) and statuses (49 records) quickly (municipalities: ~37s). **Confirmed major performance bug — see Bug #11.** Left this sync running as a background process to gather real timing evidence; final state captured below.
- **Shipment creation**: created an X Express shipment on reused order SPC-2026-000001 → confirmed exactly the documented local-label-only behavior: tracking code `TST0850300000` allocated, shipment `status: CREATED`, `syncError` field explains no real API announcement happened (`localLabelOnly: true` per [src/lib/x-express/shipments.ts:81-91](src/lib/x-express/shipments.ts#L81-L91)). This is the pre-known launch blocker from the plan, confirmed working exactly as designed — no crash, no unexpected behavior.
- **Webhook auth/processing matrix** — `POST /api/x-express/webhook`:

| Check | Result |
|---|---|
| No auth | ✅ 401 |
| Wrong key | ✅ 401 |
| Correct key, missing `x-api-sender: XExpress` | ✅ 401 |
| Authorized, malformed body | ✅ 400 |
| Authorized, valid payload, **missing optional `ReferenceGuid`** | ❌ initially 400 (Bug #12) → ✅ 200 after fix |
| Authorized, valid payload, status `PICKEDUP`, known tracking code | ✅ 200 — shipment advanced `CREATED → PICKED_UP`, order advanced to `SPREMNO_ZA_ISPORUKU`, order-status email attempted (failed with the known placeholder-Resend-key 401 — same root cause as Phase 2 Bug #4, not new) |
| Unknown `ReferenceId` | ✅ `processed:0, failed:1`, no crash, clean `processError` stored on the staged event, event stays unprocessed — correct per plan |
| Duplicate `NotifyId` | ✅ correctly deduped/skipped, no reprocessing |

**Bug #11 (found, NOT fixed — report only, architectural): N+1 sequential upserts make the X Express dictionaries sync unusable at real-world scale**
- [src/lib/x-express/sync.ts](src/lib/x-express/sync.ts) `upsertMunicipalities` / `upsertTowns` / `upsertStreets` (~lines 125-230) each loop over every fetched record and `await` a separate `db.xExpress*.upsert()` call per row — no batching (`createMany`/`Promise.all` chunking/transaction).
- Measured empirically against the real test API: municipalities (169 rows) completed in ~37s. Towns are far larger — after ~27.5 minutes of continuous running, all **4,721 towns** were fully upserted into `XExpressTown`, but the streets sync had not written a single row yet (`XExpressStreet` count still 0 at that point — either still inside the network fetch of the full national street list, or the per-row upsert loop for streets simply hadn't landed its first commit in that window). Streets for all of Serbia is expected to be several multiples of the town count.
- **Impact**: the dictionaries cron (`/api/cron/x-express/dictionaries`) would time out on any real serverless/cron platform (typical limits: 10s–15min) long before completing a full run. This makes the X Express address-autocomplete dictionaries un-refreshable in production as currently implemented.
- **Suggested fix (not applied)**: batch writes via `createMany`/chunked `Promise.all` with a concurrency limit, or move to a raw bulk upsert (`INSERT ... ON CONFLICT`), and/or split the sync into resumable batches invoked repeatedly by the cron rather than one unbounded run.
- Final state recorded before this background process was terminated (killed along with the old dev server when restoring `COURIER_SMALL_PROVIDER`, see below): `CourierSyncRun` (provider `X_EXPRESS`) — `LOCATIONS` run #1 (municipalities-only, prior to full dictionaries call): SUCCESS, 169/169, 37s. `STATUSES` run: SUCCESS, 49/49, ~10s. `LOCATIONS` run #2 (full dictionaries: municipalities+towns+streets): still `RUNNING` at kill time (no `finishedAt`/`recordsRead` recorded, since the run-summary row is only updated at the very end of the whole sync — meanwhile the individual `XExpressMunicipality`/`XExpressTown` rows were visibly populated incrementally: 169 / 4,721 respectively). `XExpressStreet` count: 0 at kill time.
- Confirmed the `STATUSES` sync itself (the smallest dataset, 49 records) completes quickly and correctly — this bug is specific to the volume of the location-dictionary datasets, not the sync mechanism in general.

**Bug #12 (found & fixed): valid webhook payload omitting optional `ReferenceGuid` wrongly rejected with 400**
- [src/lib/x-express/webhook.ts](src/lib/x-express/webhook.ts) — the `optionalText`/`optionalUuid` Zod schemas applied `.optional().nullable()` **inside** the `z.preprocess()` call. In Zod v4 (v4.4.1 installed), `.optional()`/`.nullable()` applied to the schema passed into `preprocess()` does not propagate outward to a key that's entirely missing from the input object — so a real X Express payload that simply omits `ReferenceGuid` (valid per their API — it's optional) failed validation with a 400, when it should have been accepted.
- Fix: moved `.optional().nullable()` outside the `z.preprocess()` call (now wraps the whole preprocessed schema) in both `optionalText` and `optionalUuid` ([src/lib/x-express/webhook.ts:15-27](src/lib/x-express/webhook.ts#L15-L27)).
- Verified: reproduced the broken-vs-fixed behavior in isolation first (confirmed the exact Zod v4 semantics before touching code), then confirmed the real endpoint accepts a payload with `ReferenceGuid` omitted post-fix, with correct downstream processing (shipment/order status advance as expected).
- Risk: low — schema-only change, made validation *more* permissive to match the documented-optional field, verified against the real endpoint before and after.
- **Cron webhook-first fallback confirmed**: `GET/POST /api/cron/x-express/status-sync` with bearer, `X_EXPRESS_STATUS_PATH` empty → correctly falls back to `processXExpressWebhookEvents()`, drained the one still-failing staged event from before the fix, no crash. Confirms the webhook-first-with-cron-fallback design works as intended.

### 3. Changes made this phase
- [src/lib/mygls/config.ts](src/lib/mygls/config.ts), [src/lib/mygls/client.ts](src/lib/mygls/client.ts), [src/lib/mygls/payload.ts](src/lib/mygls/payload.ts) — added/wired `toMyGlsDate()` to fix the `/Date(ms)/` format bug (Bug #9). Low risk.
- [src/lib/x-express/webhook.ts](src/lib/x-express/webhook.ts) — moved `.optional().nullable()` outside `z.preprocess()` in `optionalText`/`optionalUuid` to fix the missing-`ReferenceGuid` 400 bug (Bug #12). Low risk.
- All uncommitted, along with the Phase 2/3 fixes carried forward. No commits made this phase.

### 4. Environment / dev-server state restored
- `.env.local` `COURIER_SMALL_PROVIDER` — was temporarily `"X_EXPRESS"` for Pass B, **restored to `"MYGLS"`** at the end of this phase. Confirmed via grep post-edit.
- Dev server: killed the old (Phase 3-originated, by-then-untracked) process and the still-running dictionaries-sync background curl, then started a fresh tracked server (serverId `1509e64a-91ad-461d-9f91-2fc98d50b943`, port 3000) so the restored env var is actually loaded (Next.js reads `.env.local` only at process start). Confirmed clean startup (`✓ Ready in 351ms`, `HEAD / 200`).
- `./node_modules/.bin/tsc --noEmit --pretty false` re-run after all Phase 4 changes → ✅ clean, no errors.
- Deleted all leftover scratch DB-check scripts from the repo root (`scratchpad-check.mjs` through `scratchpad-check7.mjs`) — throwaway verification scripts, not part of the app.

### 5. Cleanup state (carried into Phase 5)
- Order **SPC-2026-000001** now has **two** shipment rows (both test artifacts, no real external resources exist for either):
  - MyGLS: `FAILED`, `syncError: "Unauthorized."`, `trackingNo: null` — nothing to `DeleteLabels`-cleanup since PrintLabels never actually succeeded against the real API.
  - X Express: `CREATED` → later advanced to `PICKED_UP` by the webhook test, `trackingNo: "TST0850300000"` — local-label-only, no real X Express resources exist either.
  - Order status is now `SPREMNO_ZA_ISPORUKU` (advanced by the X Express webhook test, was `U_PRIPREMI` at end of Phase 3).
  - **Decide in Phase 5** whether to delete these two `Shipment` rows before/as part of order cancellation, or leave them (they're harmless DB-only artifacts).
- 3 QA orders (SPC-2026-000001/2/3) still need Phase 5 cancellation to restore `relax-1133` stock (currently 6, should return to 9) — unchanged from Phase 2/3.
- Two QA admin accounts from Phase 3 (`qa-admin-test@svetpovoljnihcena.local` SUPER, `qa-admin-content@svetpovoljnihcena.local` CONTENT) still exist, still undecided for Phase 5 cleanup.
- No staged X Express webhook events left unprocessed (the one pre-fix failure was drained by the cron-fallback test).

### 6. State for next phase
- Dev server running on port 3000 (serverId `1509e64a-91ad-461d-9f91-2fc98d50b943`), fresh start, `COURIER_SMALL_PROVIDER="MYGLS"` confirmed active.
- Uncommitted files carried forward: `src/components/checkout/checkout-flow.tsx`, `src/components/layout/header.tsx` (Phase 2), `src/app/admin/narudzbine/[id]/page.tsx` (Phase 3), `src/lib/mygls/config.ts`, `src/lib/mygls/client.ts`, `src/lib/mygls/payload.ts`, `src/lib/x-express/webhook.ts` (Phase 4). No commits made.
- `./node_modules/.bin/tsc --noEmit --pretty false` clean as of end of Phase 4.
- Repo root scratch scripts cleaned up — none remain.
- MyGLS test credentials remain invalid ("Unauthorized.") — this is an environment/account issue, not something Phase 5 can fix; report as launch blocker in the final report.
- X Express dictionaries sync (background) was killed mid-run when the dev server restarted — no further action needed, evidence already captured (Bug #11).

## Phase 5 — Responsive smoke, cleanup, final report
**Model used:** Sonnet 4.6 (no explicit switch performed; findings double-checked)
**Date:** 2026-07-03

### 0. Setup
- No dev server was running at phase start (previous phase's server had exited). Started a fresh tracked server via `preview_start` (serverId `1ac42eae-73c0-402b-84cf-94488319ba9a`), port 3000. `COURIER_SMALL_PROVIDER="MYGLS"` confirmed unchanged.
- Noted two pre-existing uncommitted changes in the working tree that predate this QA session and are unrelated to it: [prisma.config.ts](prisma.config.ts) (explicit `dotenv` loading for `.env`/`.env.local`) and `svet akcija/finishing touches.md`. Neither was touched by any QA phase (Phase 1 explicitly logged "no changes made"); left as-is, out of scope.

### 1. Mobile viewport smoke test (375×812)
- **Storefront: ✅ PASS, no console errors.** Home, category (`/k/namestaj`), product (`/p/relax-1133`), cart (`/korpa`), and checkout steps 1–2 (`/checkout/podaci` — guest/register/login chooser, then the shipping-info form) all render cleanly with proper mobile layout (hamburger nav, sticky add-to-cart bar, step indicator). Re-verified the Phase 2 Bug #2 fix (`AnimatePresence mode="wait"` removal) holds on mobile — step 1→2 transition was instant, no hang.
- Cosmetic-only observation, not a bug: some product images render as a generic placeholder icon instead of a photo (e.g. `relaxo-1176`) — this is missing product media in seed data, unrelated to viewport size (confirmed the same on desktop in earlier phases).

**Bug #13 (found, NOT fixed — architectural): admin panel is unusable below tablet width (~768px)**
- The admin shell ([src/app/admin/layout.tsx](src/app/admin/layout.tsx) and similar) renders the sidebar `<nav>` as a fixed-width flex child (259px) next to `<main class="flex-1">`, with no responsive breakpoint collapsing it into an off-canvas/hamburger drawer the way the storefront header does.
- At 375px viewport width, this isn't just visually cramped — it's **functionally inaccessible**: confirmed via computed styles that `<body>` has `overflow-x: clip` and `<html>` has `overflow-x: hidden`, so the ~40% of every admin page pushed off-screen to the right (order tables, filters, form fields, dashboard cards) cannot be reached by scrolling, pinch-zoom, or any other means. Reproduced on `/admin` (dashboard) and `/admin/narudzbine` (orders list).
- At tablet width (768px) it's usable but still tight — some table columns remain truncated at the right edge.
- Confirmed the viewport meta tag is correct (`width=device-width, initial-scale=1`), so this is a genuine CSS/layout gap, not a missing-meta-tag issue.
- Not fixed inline: converting the admin shell to a responsive collapsible-sidebar/drawer layout is a real UI feature (analogous in scope to the existing storefront mobile nav), not a small one-line fix — out of this session's "small inline fix" policy. Flagging for a follow-up. Impact is limited in practice since admin panels are typically operated from desktop, but worth fixing before assuming any staff will ever need phone/tablet access (e.g. warehouse floor, courier handoff).

### 2. Cleanup

**Bug #14 (found & fixed): admin manual order cancellation never restored stock**
- [src/app/admin/narudzbine/[id]/page.tsx](src/app/admin/narudzbine/%5Bid%5D/page.tsx) `updateStatus` — the status-change server action (used by the "Promena statusa" dropdown on every order detail page) only ever did `db.order.update({ data: { status } })` + an `OrderStatusEvent`. Stock restoration on cancellation only existed in one place in the whole codebase: [src/lib/payments/expiry.ts](src/lib/payments/expiry.ts)'s automatic payment-expiry job (`expirePendingPayments`), which only fires for orders stuck in `KREIRANO` with an expired *online* payment (IPS/KARTICA/GOOGLE_PAY/APPLE_PAY) — it never covers COD orders or orders an admin manually cancels from any other status.
- Consequence: **any order a staff member cancels by hand through the admin UI permanently loses that inventory** — the `Product.stock` decremented at checkout is never given back. Confirmed empirically: before the fix, setting SPC-2026-000001 (COD, stock already decremented) to `OTKAZANO` left `Product.stock` unchanged and `stockRestoredAt`/`cancelledAt` both `null`.
- Fix: in `updateStatus`, when the new status is `OTKAZANO` and the order's `stockRestoredAt` is still `null`, the transaction now also sets `cancelledAt`/`stockRestoredAt` and increments `Product.stock` for each line item — mirroring the exact pattern already used and tested in `expiry.ts`. Idempotency guard (`stockRestoredAt: null` check) prevents double-restoring stock if an order is cancelled more than once or was already auto-cancelled by the expiry job.
- Verified live, three times, using this exact phase's own QA cleanup (see below): `relax-1133` stock went 6 → 7 → 8 → 9 across the three cancellations, `cancelledAt`/`stockRestoredAt` populated correctly each time, `OrderStatusEvent` timeline still recorded normally.
- Risk: low-moderate — touches inventory-affecting transactional code, but the added logic is additive (only triggers on the `OTKAZANO` transition), guarded against double-firing, and directly reuses an already-shipped, already-tested pattern from `expiry.ts` rather than inventing new logic. `tsc --noEmit` clean after the change.

**QA test order cancellation (via the now-fixed cancel flow):**
| Order | Payment | Status before | Status after | Stock effect |
|---|---|---|---|---|
| SPC-2026-000001 | COD | SPREMNO_ZA_ISPORUKU | OTKAZANO | `relax-1133` 6→7 |
| SPC-2026-000002 | IPS | KREIRANO | OTKAZANO | `relax-1133` 7→8 |
| SPC-2026-000003 | KARTICA | KREIRANO | OTKAZANO | `relax-1133` 8→9 |

`relax-1133` stock confirmed restored to **9** — the exact pre-QA baseline from Phase 1/2.

**MyGLS labels:** nothing to delete. PrintLabels never succeeded against the real test API (Phase 4 credential blocker, `syncError: "Unauthorized."`, `trackingNo: null`) — no real MyGLS resource was ever created, confirmed again by direct DB read this phase.

**X Express:** the one test shipment (`trackingNo: "TST0850300000"`, status `PICKED_UP`) is local-label-only by design (`localLabelOnly: true`) — no real X Express resource exists to clean up. Left the `Shipment` row in place as historical evidence tied to the now-cancelled order; harmless.

**Staged X Express webhook events:** 2 rows remain in `XExpressWebhookEvent`, both harmless test artifacts from Phase 4's auth/processing matrix — one successfully processed (`SPC-2026-000001`, `PICKEDUP`), one intentionally-unprocessed negative test (unknown `ReferenceId SPC-2026-999999-NOPE`, clean `processError` stored, no crash). Left as-is per plan instruction ("document... if left").

**QA admin accounts:** both `qa-admin-test@svetpovoljnihcena.local` (SUPER) and `qa-admin-content@svetpovoljnihcena.local` (CONTENT) were **disabled** (`AdminUser.enabled = false`), not deleted — `AuditLog.actorId` has a real foreign-key relation to `AdminUser` (`onDelete` unspecified → Postgres default `NO ACTION`), and both accounts have audit-log history from Phases 3–5 (RBAC tests, order cancellations, courier actions). Deleting them would either hard-fail on the FK constraint or (if cascaded) destroy audit history. `enabled` is enforced at login (`src/lib/auth/session.ts:48`, `src/lib/auth/auth.ts:220-225`), so both accounts can no longer sign in. The 2 production `SUPER` admins (`admin@svetpovoljnihcena.rs`, `admin@spc.local`) are untouched.

### 3. Changes made this phase
- [src/app/admin/narudzbine/[id]/page.tsx](src/app/admin/narudzbine/%5Bid%5D/page.tsx) — added stock restoration + `cancelledAt`/`stockRestoredAt` on admin-initiated `OTKAZANO` transitions (Bug #14). Moderate risk, verified live 3×.
- DB-only (not code): 3 QA orders → `OTKAZANO`; 2 QA admin accounts → `enabled = false`.
- `./node_modules/.bin/tsc --noEmit --pretty false` re-run after the change → clean.
- All scratch verification scripts (`scratchpad-check.mjs`) created and deleted within this phase — none left in the repo.

### 4. State at end of QA
- Dev server running on port 3000 (serverId `1ac42eae-73c0-402b-84cf-94488319ba9a`).
- `COURIER_SMALL_PROVIDER="MYGLS"` — confirmed final state.
- All 3 QA orders `OTKAZANO`, stock fully restored (`relax-1133`: 9, matches pre-QA baseline).
- No MyGLS labels to delete (none ever succeeded). 1 harmless X Express local-label shipment row left as historical record. 2 harmless staged webhook events left as historical record.
- Both QA admin accounts disabled (not deleted, to preserve audit-log FK integrity). Both original production SUPER admins untouched.
- Uncommitted files with real QA fixes: `src/components/checkout/checkout-flow.tsx` (Phase 2), `src/components/layout/header.tsx` (Phase 2), `src/app/admin/narudzbine/[id]/page.tsx` (Phase 3 + Phase 5), `src/lib/mygls/config.ts`, `src/lib/mygls/client.ts`, `src/lib/mygls/payload.ts` (Phase 4), `src/lib/x-express/webhook.ts` (Phase 4). No commits made this session (none requested).
- Two unrelated pre-existing uncommitted files (`prisma.config.ts`, `svet akcija/finishing touches.md`) predate the QA session and were left untouched.

## Phase 5b — Post-report bucket verification (order-receipts, reclamation-uploads, shipment-labels)
**Model used:** Sonnet 4.6
**Date:** 2026-07-03

User created the `order-receipts` Supabase bucket (Public, 5MB limit, MIME restricted to `application/pdf`) to close Phase 2 Bug #3. Asked to verify that bucket plus the two pre-existing buckets (`reclamation-uploads`, `shipment-labels`) actually work end-to-end, not just that they exist.

**Note:** by this point in the session, all QA code fixes from Phases 2–5 (checkout, admin, MyGLS, X Express, stock-restore-on-cancel) had been committed by the user as `aaf9025 Apply QA fixes across checkout, admin, courier, and payments` — outside this conversation. Confirmed via `git log`; no action needed, just noting the working tree is now clean of those diffs.

### order-receipts — ✅ confirmed working end-to-end
- Registered a fresh QA customer (`qa-phase5b@example.com`) via the UI, logged in.
- **UI checkout blocker hit during this test (not a new bug — pre-existing UI-automation friction):** the final "Potvrdi porudžbinu" step requires the `consent` checkbox to be checked, but `consent` has no HTML `required` attribute — it's gated purely in client-side JS/React state with no visible inline error when unchecked. Clicking submit with it unchecked does nothing at all (no request fires, no error shown) rather than blocking with a message. Checking the box first fixed it. This is a *silent no-op*, same family as Bug #8/#10 (server-action failures with zero UI feedback) but on the client-validation side — flagging as a related finding, not a new numbered bug, since the pattern is already documented.
- Given that friction, placed the actual test order via a direct authenticated `POST /api/checkout/order` call instead (same precedent as Phase 2's orders #2/#3) — order **SPC-2026-000004** created, COD, `relax-1133` × 1.
- Confirmed via DB: `Invoice.pdfUrl` populated (`https://…/storage/v1/object/public/order-receipts/SPC-2026-000004/PR-SPC-2026-000004.pdf`), `pdfObjectKey` set.
- Confirmed via `curl`: the URL is publicly fetchable — `200`, `1845` bytes, `content-type: application/pdf`. Bug #3 (Phase 2) is resolved.
- `Invoice.status` is still `EMAIL_FAILED` (`resend:401 API key is invalid`) — expected, that's the separate, still-open Bug #4 (placeholder Resend key), unaffected by the bucket fix.

### reclamation-uploads — ✅ confirmed working end-to-end
- **New finding (not a bug, a gap): there is no customer-facing UI for submitting a reclamation at all.** The content page at `/reklamacije` tells customers to go to "Moj nalog → Reklamacije," but grepping `src/app/(account)/nalog/*` confirms no such page exists — the only account pages are `adrese`, `email/potvrdi`, `lista-zelja`, `porudzbine[/id]`, `prijava`, `registracija`. The reclamation feature is fully implemented server-side (`POST /api/reclamations`, `POST /api/reclamations/upload` with Zod validation, rate limiting, order-ownership checks, presigned-upload flow) but nothing in the frontend calls either endpoint. Confirmed via `grep -rln "reclamations/upload\|/api/reclamations" src/` outside `src/app/api/` — zero matches. Right now the only real path for a customer to file a reclamation is raw email (parsed by `src/lib/email/inbound.ts`), not the website.
- Tested the backend directly (same logged-in QA customer/session as above, order SPC-2026-000004, sku `1133`):
  1. `POST /api/reclamations/upload` (presign) → `200`, returned a signed upload URL + public URL.
  2. `PUT` the actual JPEG bytes to the signed URL → `200`, uploaded successfully.
  3. Verified via `curl` on the public URL → `200`, `835` bytes, `content-type: image/jpeg` — file genuinely landed in the bucket.
  4. `POST /api/reclamations` with that photo URL → `201`, reclamation **R-1-SPC-2026-000004** created.
  5. Confirmed via DB: `Reclamation` row correct, `ReclamationPhoto` row correctly linked with the exact uploaded URL.
- Bucket itself, signed-upload mechanics, and the full create-reclamation-with-photo flow all work correctly — the only gap is the missing frontend form to reach it.

### shipment-labels — ✅ bucket connectivity confirmed (MyGLS API blocker unrelated, already documented)
- MyGLS test credentials are still invalid (Phase 4 finding), so a real end-to-end PrintLabels → upload can't be exercised this session.
- Isolated the bucket layer from the MyGLS-API layer: wrote a throwaway script that calls the *exact* same Supabase Storage calls as `uploadMyGlsLabelPdf`/`downloadMyGlsLabelPdf` (`src/lib/mygls/labels.ts`) — same bucket name resolution (`MYGLS_LABEL_BUCKET` env fallback to `"shipment-labels"`), same client (`createAdminClient()`, service-role key), same object-key pattern (`mygls/{orderNumber}/{shipmentId}.pdf`).
- Result: upload succeeded, download succeeded and byte-for-byte matched the uploaded content, cleanup (`remove()`) succeeded. **This confirms the bucket, service-role permissions, and object-key structure are all correct and production-ready** — the *only* remaining blocker for MyGLS shipments is the invalid test API credentials (unchanged from Phase 4), not storage.

### Cleanup
- Order SPC-2026-000004 cancelled (`OTKAZANO`) via the admin UI using the now-fixed stock-restore flow (Bug #14) — `relax-1133` stock confirmed back to **9**.
- Left in place (not deleted, mirrors this session's established pattern of leaving small harmless linked test artifacts rather than creating dangling references): the uploaded receipt PDF and reclamation photo in Supabase Storage (both are referenced by DB rows — `Invoice.pdfUrl`, `ReclamationPhoto.url` — deleting the files without deleting those rows would create broken links, which is worse than leaving tiny, clearly QA-path-prefixed test files); reclamation `R-1-SPC-2026-000004`; QA customer `qa-phase5b@example.com`.
- `qa-admin-test@svetpovoljnihcena.local` was temporarily re-enabled (`enabled: true`) to perform the order cancellation above (browser-driven login to the disabled account correctly failed — confirms the Phase 5 disable is enforced), then **disabled again** at the end of this phase. Final state: disabled, matching end-of-Phase-5.
- All scratch verification scripts created and deleted within this phase — none left in the repo. `git status` confirms only `.claude/`, `QA-FINDINGS.md`, `QA-REPORT.md`, `leadgen-plan/` remain untracked; no stray files.

## 2026-07-10 — Partner-integration push: IPS test PGW readiness, MyGLS production attempt
**Model used:** Fable 5 (orchestrator) + Opus 4.8 (payment build/review) + Sonnet 5 (compliance, MyGLS QA)
**Date:** 2026-07-10

### IPS / Payten PGW (test credentials received 2026-07-01)

- **Critical pre-existing bug (fixed):** `/api/payment/ips/callback` required HMAC signature headers (`x-ips-signature`, `x-ips-timestamp`) that Payten never sends — per IPS PGW Service Specification 1.5 §4.1 the callback is a plain unsigned JSON POST. Every real callback would have been rejected 400. Rewritten: callback body is treated as an untrusted wake-up ping — per-IP + per-order rate limits, DB gate (order must have an IPS Payment row), already-PAID short-circuit, then server→gateway `/ips/v2/checkStatus` round-trip whose result (not the body) is applied; route always answers 200 per spec. (`src/app/api/payment/ips/callback/route.ts`, `src/lib/payments/ips.ts`, `src/lib/security/rate-limit.ts`.)
- **Release review (Opus) round 1: BLOCK** — found that mapping any non-"00" checkStatus response to `FAILED` let an unauthenticated forged callback flip an in-flight payment PENDING→FAILED, removing the order from `expirePendingPayments` and stranding reserved stock forever (inventory DoS). Fixed: non-"00" now updates audit fields only, payment stays PENDING, `expiry.ts` remains the sole FAILED writer. Also fixed on review: `/ips/v2/refund` excluded from the 401 auto-retry (double-refund risk), and payment confirmation made exactly-once via a `updateMany({status: {not: "PAID"}})` + `count===1` guard inside the transaction (concurrent callback + return-URL race could double-fire fiscal receipt + email). **Round 2 verdict: SHIP.**
- Verified already-correct: orderId consistency (gateway always gets `order.number`), port-9092 base URL handling, no fake QR in the live path (customer is redirected to Payten's hosted `qrCodeURL`), amounts always server-derived.
- Hardening added: token-lifetime clamp [60s, 24h] (spec's `tokenExpiryTime` units ambiguous) + single 401 token-refresh retry for eCommerce/checkStatus.
- Env: real test parameters wired into `.env.local` (`IPS_BASE_URL=https://ips.pgw.payten.com:9092`, `IPS_TID=SVETPOV1`, 64-char `IPS_USER_ID`); obsolete `IPS_CALLBACK_*` signature vars removed from `.env.example`.
- **Still blocked on Payten:** IP whitelist (178.221.225.75) + merchant logo must be sent on the email thread before any call will go through. Live E2E pass (order → QR → pay → PAID → fiscal/email, negative paths, refunds) is a backlog item pending whitelist.

### IPS site compliance (Uputstvo za rad IPS internet prodajnog mesta)

- **Fake legal data found and fixed:** `src/lib/merchant.ts` had placeholder matični broj `20000000` → corrected to real MB `22112597`; `src/lib/brand.ts` legalName → registered form "SVET POVOLJNIH CENA DOO BEOGRAD (NOVI BEOGRAD)"; added šifra delatnosti 4791.
- **Open NEEDS-USER:** PIB is still placeholder `100000000` in `src/lib/merchant.ts` (feeds fiscal receipts, order emails, legal pages — single constant); bank account/name also placeholder (`160-000000-00` / "Banca Intesa"; Payten email says račun 265331031000537534, Raiffeisen).
- Added: "Kada se zadužuje vaš račun" section on `/uslovi-isporuke`; IPS-exclusive-refund statement on `/reklamacije`. Verified OK: PDV note in checkout, privacy page, IPS Skeniraj logo on homepage footer + payment selection + QR confirmation block, itemized order spec before payment.

### MyGLS production attempt (per Saša Vujičić: no test env; production creds valid; labels inert until najava)

- `MYGLS_ENV=production` set in `.env.local`. Controlled create→verify→delete pass **attempted, blocked before reaching MyGLS**:
  1. **Runtime DB hang:** with `DATABASE_URL` empty, `src/lib/db.ts` fell through to the transaction-pooler URL (port 6543) and the first Prisma call hung indefinitely (0% CPU, 8 min) — same TLS failure class as the known `prisma migrate` hang, contradicting the earlier "runtime unaffected" note (Phase 1 had verified the pg-driver fixup worked; on 2026-07-10 it did not). **Remedy applied:** `DATABASE_URL` now set to the `POSTGRES_URL_NON_POOLING` value (port 5432); AGENTS.md note corrected.
  2. **Pickup address is placeholder** ("Test ulica 1" / test@example.com) — agent correctly refused to write a fabricated address into MyGLS production shipment history. Real `MYGLS_PICKUP_*` values required (NEEDS-USER) before the pass re-runs.
- MyGLS production credential validity therefore remains **unverified**; the code path itself raised no red flags (Phase-4 date-format bug already fixed). Nothing was created in MyGLS production; no cleanup needed.

### Fiscalization decision closed

- Tax authority/accountant answer: final receipt (promet-prodaja) immediately at payment for IPS prepayment; refundacioni račun on returns. Matches current implementation exactly (`invoiceType: "normal"` at IPS confirmation; refunds via /admin/fiskalizacija). No code change; backlog item ticked.

### Verdict

IPS integration is code-ready for the test PGW (SHIP after two-round payment review); externally blocked on Payten whitelist. MyGLS blocked on real pickup address (env fixed for the DB hang). Badi sandbox spike blocked on Luka pasting the new account's API creds. X Express unchanged (waiting on their reply).

## 2026-07-10 (afternoon) — badi live spike + MyGLS production round-trip
**Model used:** Fable 5 (orchestrator, live API probes) + Opus 4.8 (badi adapter rewrite)
**Date:** 2026-07-10

### badi.rs — production API verified, adapter fixed, receipts blocked on PFR

- First pasted API key 401-ed everywhere — root cause: the key was **never saved** in the badi dashboard (the "Sačuvaj" step). Second key authenticates (Basic auth confirmed; GET/POST/DELETE /products verified live; catalog left empty).
- Real contract vs adapter assumptions (all fixed in `src/lib/fiscal/badi.ts`, migration `0017_badi_provider_sku`): `sku` must be a NUMBER (auto-assigned when omitted; persisted per internal SKU in `FiscalProductSync.providerSku`; receipts reference the numeric badi sku); `productType` REQUIRED ("product"/"service"); receipts need `storeId` (= dashboard "ID klijenta"); `clientId` is REJECTED on /products; errorCode 40090001 is badi's GENERIC validation code (force-resync heuristic tightened accordingly).
- Receipt issuance (attempted with legally-safe `invoiceType: "training"`) fails 400/40080001 "No client with the given storeId or clientId is connected" — badi relays receipts to a connected fiscal processor. **Solution chosen: V-PFR certificate mode** (Tax Authority cloud PFR; badi api-docs `pfx`/`password`/`pac` receipt headers) so no always-on machine is needed; adapter support shipped (`BADI_VPFR_PFX/PASSWORD/PAC`), `BADI_INVOICE_TYPE` env added for the eventual training E2E. Waits on the client: PGJO prijava ("internet prodaja") + bezbednosni element u elektronskom obliku.

### MyGLS — production credentials CONFIRMED, full label round-trip PASSED

Direct API round-trip against api.mygls.rs (after the earlier DB-hang fix; no dev server needed):
1. `GetParcelStatuses` (dummy) → authenticated business response, not "Unauthorized" — **production creds valid**, matching Saša Vujičić's statement.
2. `PrintLabels` with COD 1000 RSD, real pickup address (Vojvođanska 401): first rejected with ErrorCode 56 "Webshop engine is required!" (root-body `WebshopEngine` — app client already sends it), then **ErrorCode 13 "Invalid data in Height/Width/Length" — REAL BUG: `buildMyGlsParcelForOrder` sent no dimensions; production requires them.** Fixed in `src/lib/mygls/payload.ts` (default 30/40/50 cm box). With dimensions: SUCCESS — ParcelId 507053635, ParcelNumber 9002486576, 113 KB PDF label, COD accepted, zero errors.
3. `GetParcelStatuses` on the fresh parcel → ErrorCode 26 "Parcel not found with current settings" — expected (parcels enter GLS ops only after pickup scan); `sync.ts` tolerates it (empty `ParcelStatusList` → zero events, no false failure).
4. **Cleanup verified**: `DeleteLabels` → `SuccessfullyDeletedList` contains ParcelId 507053635. Nothing dangling in MyGLS production; no DB rows created (direct API test, deliberately outside the app).
- Residual cosmetic artifact: one stale `CourierSyncRun` row (id `cmrevooxs00016hgodt88t21n`, status RUNNING) from the earlier killed dev-server attempt.

### IPS — live gateway probe

- `POST /res/v1/generateToken` on ips.pgw.payten.com:9092 answers (TLS + routing fine — not network-blocked): HTTP 401 `{"sessionToken":null,"tokenExpiriyTime":null}` pending Payten's IP whitelist. **Real API misspells the expiry field (`tokenExpiriyTime`)** — parser fixed to accept both spellings (`src/lib/payments/ips.ts`).

### Verdict

MyGLS: **production-ready** (creds + label print + COD + delete all verified live; dimension bug fixed) — remaining: real pickup-address confirmation and the najava-prikupa process answer from MyGLS. badi: adapter contract-ready; blocked solely on bezbednosni element / V-PFR from the client's side. IPS: blocked solely on Payten whitelist.
