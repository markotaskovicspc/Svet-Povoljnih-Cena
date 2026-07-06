# QA Report — Svet Povoljnih Cena (pre-launch local test)

**Date range:** 2026-07-01 → 2026-07-03
**Scope:** storefront, checkout, customer auth, full admin panel, MyGLS (test API), X Express (webhook-first). Local only — no production endpoints, no real emails/payments/SMS/Viber, no destructive external calls.

## Summary

The application is **close to launch-ready but not launch-ready today**. Storefront, checkout, customer auth, and the admin panel are functionally solid — of 14 bugs found, 6 were fixed inline this session (including one full checkout blocker and one silent-inventory-loss bug), and the remaining 8 are documented with clear repro/root cause. Nothing found is a security vulnerability: auth, RBAC, rate-limiting, and unauthenticated-request handling all passed a dedicated security sweep clean.

**What blocks launch right now, in priority order:**
1. **MyGLS test API credentials are invalid** (`"Unauthorized."` on every call) — the courier integration cannot be verified end-to-end until valid credentials are provided. This is an account/environment issue, not a code bug. (Storage layer confirmed *not* the problem — see Courier findings.)
2. **Email is silently broken** — `RESEND_API_KEY` is an unfilled placeholder, so every order-confirmation and status-change email fails with a 401 that is *swallowed* (fire-and-forget). No customer email works at all right now, and nothing surfaces this to the team without checking the DB.
3. **X Express never actually announces an order** — `localLabelOnly: true` is hard-coded because the real portal API docs were never provided. Confirmed working exactly as designed (no crash), but it means X Express is not a real shipping option yet.
4. **There is no customer-facing UI to submit a reclamation** — the site's own `/reklamacije` page tells customers to use "Moj nalog → Reklamacije," but that page doesn't exist anywhere in the account section. The backend (presigned photo upload + reclamation creation) is fully built and verified working — see Real-user flows and Bug #15 — it's just unreachable from the website.

✅ **Resolved since the report was first written:** the `order-receipts` Supabase bucket was created and verified end-to-end (receipt PDFs now generate and are publicly fetchable — Bug #3); `reclamation-uploads` and `shipment-labels` buckets were also verified end-to-end working correctly (see Courier findings and Real-user flows for detail).

Items 2–4 need real credentials, portal docs, or a product decision on the missing reclamation UI — none fixable by this QA session, all documented below.

## Commands run

| Command | Result |
|---|---|
| `npm run lint` | ✅ clean |
| `./node_modules/.bin/tsc --noEmit --pretty false` | ✅ clean (re-run after every code change; clean at every checkpoint including the final Phase 5 fix) |
| `npm run build` (Turbopack) | ✅ compiled in 3.7s, all 38 static pages + all app/api/admin/cron routes built |
| `npx prisma migrate status` / `db:deploy` | Schema already up to date (migration `0013_erp_phase2_masterdata` was already applied — the plan's "pending migration" premise was stale). CLI required `POSTGRES_URL_NON_POOLING` as a workaround for a pooler TLS hang (dev-tooling nuance, doesn't affect the running app — see Phase 1 in `QA-FINDINGS.md`). |
| Direct read-only Postgres queries (`pg` driver, throwaway scratchpad scripts, always deleted after use) | Used for stock/order/admin verification throughout; no scratch files left in the repo |
| `curl` against ~15 admin API routes + 5 cron routes, unauthenticated and with wrong bearer tokens | All correctly rejected (see Admin panel findings → Security) |
| Real calls to MyGLS **test** API (`api.test.mygls.rs`) — PrintLabels, GetParcelStatuses | Reached the real API; blocked by invalid credentials (see Courier findings) |
| Real calls to X Express **test** dictionaries/status endpoints | Succeeded (municipalities, towns, statuses) |
| `curl` against `POST /api/x-express/webhook` — full auth + payload matrix | See Courier findings |

## Environment findings

- `.env.local` has 157 vars vs 132 in `.env.example` — diff is additive only, all benign (Supabase/OAuth provisioning vars).
- `X_EXPRESS_WEBHOOK_API_KEY` and `X_EXPRESS_WEBHOOK_SECRET` are byte-for-byte identical values; code treats them as interchangeable auth methods. Not a bug, but worth deduplicating to one secret.
- `NEXTAUTH_SECRET=$AUTH_SECRET` variable expansion confirmed working as documented Next.js behavior.
- `DATABASE_URL` is empty by design; the app falls back to `POSTGRES_PRISMA_URL` at runtime (confirmed working — the Prisma CLI's migration engine needs `POSTGRES_URL_NON_POOLING` instead, a dev-tooling-only nuance, see Commands run above).
- Several `.env.local` placeholders are silently *worse* than empty — they pass the code's "is this configured" check and then fail at the real call. Full list and exact fixes: see [Still blocked](#still-blocked) and the "Post-QA production env setup checklist" in the original plan (`~/.claude/plans/fable plan.md`).
- No test runner exists in the repo (no jest/vitest/playwright) — all testing this session was manual/scripted. Recommended in [Next steps](#recommended-next-steps).

## Admin panel findings

### Auth & security — all ✅
| Check | Result |
|---|---|
| Unauthenticated `/admin`, `/admin/narudzbine` | 307 → `/admin/prijava` |
| Wrong credentials | Generic error, no email-existence leak |
| Rate limiting (5/15min) | Confirmed empirically — 7 rapid attempts, exactly 5 DB round-trips, then short-circuited; rate-limited response indistinguishable from wrong-password |
| Valid login / session persistence / logout | All confirmed, logout confirmed server-side (not just client redirect) |
| RBAC negative test (CONTENT role vs OPS-only pages) | Sidebar server-filtered; direct navigation redirected with "Nemate ovlašćenja"; same guard (`requireAdminAction`) protects both page render and the underlying server action |
| Admin API routes unauthenticated (`erp/*/commands`, `shipments/*/label`, `invoices/*`, `account/addresses`) | 307/405, 0-byte bodies, no data leakage |
| Cron routes without/with-wrong bearer (`mygls/status-sync`, `mygls/master-data`, `x-express/status-sync`, `x-express/dictionaries`, `x-express/webhook-events`) | All 401, generic error (no info leak) |
| Secret/static-file leakage (`/.env`, `/prisma/schema.prisma`, `/.git/config`, grep of all rendered HTML/JS for key patterns) | All 404 / no matches |
| Design note (not a bug) | `/api/admin/*` returns 307 redirects rather than JSON 401 for unauthenticated `fetch` calls — unconventional for an API but not a security issue |

### Route sweep — 27 top-level routes + 7 ERP submodules, all ✅ 200, no console/server errors
`kontrolna tabla, akcije, audit-log, baneri, checkouti, dostava, erp (+ artikli, dobavljaci, nabavne-cene, porudzbenice, porudzbenice-po-artiklima, ulazne-fakture, mp-cene), fiskalizacija, heroji, izvestaji, kategorije, komentari, narudzbine, newsletter, oglasi, piktogrami, placanje, pocetna, preporuke, proizvodi, promo-traka, reklamacije, sadrzaj, tabovi, vauceri, viber, xml-import` — full detail and payload-size notes in `QA-FINDINGS.md` Phase 3.

- Orders: list/filter/search, status transitions (KREIRANO→POTVRDJENO→U_PRIPREMI), audit log entries, and cancellation (this phase, see Bugs #14) all verified.
- Products: zero-media product renders cleanly; server-side negative-price validation correctly blocks bad data (Zod `nonnegative()`).
- xml-import: the plan's `XML_SUPPLIERS` env-var premise was stale — that var isn't referenced anywhere in the code; the page is fully DB-driven with 19 suppliers already configured. No imports were triggered (per plan).
- **Mobile (this phase, 375px):** storefront is fully responsive and clean. **Admin panel is not** — see Bug #13.

## Courier findings

### MyGLS
- Config/URL construction, SHA512 auth hashing, and test-base-URL routing all verified correct.
- **Blocker: MyGLS test credentials are invalid.** Real API returns `"Unauthorized."` on every call (after clearing a real account lockout hit during testing). This blocks master-data sync, PrintLabels, status-sync, DeleteLabels, and ModifyCOD from ever succeeding end-to-end. **Not fixable by this session — needs new/valid MyGLS test (and eventually production) credentials.**
- Error paths verified working correctly *despite* the credential blocker: ineligible orders are rejected cleanly before any API call; real API rejection persists a `FAILED` shipment with the error message, no crash.
- Bug #9 (fixed) below unblocked shipment-create requests from failing before they even reached MyGLS's auth layer — confirmed the *only* remaining blocker is the credential issue.
- **`shipment-labels` Supabase bucket confirmed fully functional**, isolated from the MyGLS API layer: exercised the exact upload/download code path (`src/lib/mygls/labels.ts`) directly against the bucket — upload, download (byte-for-byte match), and cleanup all succeeded. This proves storage isn't part of the blocker; the credential issue above is the *only* thing standing between this integration and a real end-to-end pass.

### X Express
- Config load and dictionaries sync (municipalities 169 records, statuses 49 records) work correctly against the real test API.
- **Confirmed pre-declared gap: X Express never actually announces an order.** `src/lib/x-express/shipments.ts:81-91` hard-codes `localLabelOnly: true` because the real portal submit API was never documented. Verified working exactly as designed: tracking code allocated locally, shipment created, clear `syncError` shown in admin, no crash. **This needs the real X Express portal API docs before it can be finished — not something this session can implement.**
- Webhook auth/processing matrix (`POST /api/x-express/webhook`) — full pass after Bug #12 fix: no-auth/wrong-key/missing-sender-header all 401, malformed body 400, valid payload processes and advances shipment+order status, unknown tracking code fails cleanly (no crash), duplicate `NotifyId` deduped. Cron webhook-first fallback (`/api/cron/x-express/status-sync` with empty `X_EXPRESS_STATUS_PATH`) confirmed draining staged events correctly.
- **Architecture gap, confirmed: courier provider selection is global, not per-order** (`COURIER_SMALL_PROVIDER` in `src/lib/courier/registry.ts`). Testing both providers required an env-var edit + dev-server restart. **Recommended fix:** add a per-order provider selector to the admin create-shipment form (persist the chosen provider on the `Shipment` row, which the schema already supports — `provider` is already a per-row field) so ops can choose MyGLS vs X Express per order without a global env flip.
- Bug #11 below (N+1 dictionary sync) means the X Express dictionaries cron would time out in production before completing a full run.

## Real-user flows

**Persona: guest customer buying furniture, paying cash on delivery**
1. Land on homepage → browse category → open product → add to cart. **Expected/Actual: match**, no console errors, mobile and desktop both clean.
2. Go to cart → adjust quantity → proceed to checkout. **Expected/Actual: match.**
3. Choose "continue as guest" → fill delivery info → confirm identity. **Expected: smooth step transition. Actual (before fix): hung indefinitely (Bug #2, now fixed) — confirmed fixed on both desktop and mobile.**
4. Place order with COD + courier delivery. **Expected: order created, stock decremented, confirmation shown, confirmation email sent. Actual: order created and stock decremented correctly; confirmation page loads; email silently fails (Bug #4, placeholder Resend key) — customer never receives confirmation and nothing in the UI indicates this.**
5. Staff processes the order through KREIRANO → POTVRDJENO → U_PRIPREMI → SPREMNO_ZA_ISPORUKU in admin, creates a courier shipment. **Expected/Actual: match** for MyGLS/X Express request construction; blocked from full success only by the external credential/API-implementation gaps above.
6. Order needs to be cancelled (wrong address, customer changed mind, etc.). **Expected: order cancelled, reserved stock returned to sale. Actual (before fix): order cancelled but stock silently never returned (Bug #14, now fixed) — every manually-cancelled order would have permanently "leaked" inventory in production.**

**Persona: registered customer, browsing on a phone**
- Registration, login, logout, session persistence, protected-route redirects: all pass, no console errors, on both desktop and 375px mobile.
- Full storefront + checkout (steps 1–2 tested this phase) is clean and responsive on mobile.

**Persona: ops staff member managing orders**
- Desktop admin: full route sweep, RBAC, and security sweep all pass (see above).
- **Mobile/tablet admin: broken (Bug #13)** — if any staff ever need to process an order from a phone (e.g. warehouse floor), they currently cannot; ~40% of every admin page is unreachable below ~768px width.

**Persona: customer whose delivered item arrived damaged, wants to file a reclamation with photos**
1. Customer reads `/reklamacije`, which tells them to go to "Moj nalog → Reklamacije." **Expected: a form to describe the issue and attach photos. Actual: that page doesn't exist — see Bug #15.** A real customer following the site's own instructions hits a dead end.
2. Tested the underlying capability directly via API (logged in as the order's owner): request a signed upload URL for a photo (`POST /api/reclamations/upload`) → upload the photo bytes to that URL → submit the reclamation referencing it (`POST /api/reclamations`). **Actual: all three steps worked correctly** — the photo is verifiably stored in `reclamation-uploads` (fetched back via its public URL, exact byte match) and the reclamation is created with the photo correctly linked in the database. The backend for this feature is solid; only the frontend entry point is missing.

**Persona: customer wants their purchase receipt**
1. Place an order (COD). **Expected: a receipt PDF is generated and available. Actual: previously failed silently ("Bucket not found" — Bug #3). Now fixed** — placed a fresh test order and confirmed the receipt PDF generates and is publicly downloadable (`200`, correct `application/pdf` content type, non-empty).

## Bugs

| # | Severity | Status | Summary |
|---|---|---|---|
| 1 | Low | ✅ Fixed | Desktop header didn't reflect login state |
| 2 | **Critical** | ✅ Fixed | Checkout step transition hung indefinitely — full checkout blocker |
| 3 | Medium | ✅ Fixed (2026-07-03 follow-up) | `order-receipts` Supabase bucket didn't exist — created (Public, 5MB limit, `application/pdf` only) and verified end-to-end: a fresh test order's receipt PDF generated and was publicly fetchable |
| 4 | **High** | Not fixed (infra/ops) | Order emails silently fail — placeholder `RESEND_API_KEY` triggers real (failing) API calls instead of dev-mode logging |
| 5 | Medium | ✅ Fixed (2026-07-03 follow-up) | IPS payment-start crashes with an uncaught 500 instead of a graceful error page — `getIpsConfig()` now validates the base URLs and throws `IpsConfigError` so placeholder/malformed values fail gracefully (503) like missing ones |
| 6 | Medium | Not fixed (ops toggle, not code) | `KARTICA` payment method enabled in DB despite gateway being unconfigured. No code seed exists — flip it in the admin UI at `/admin/placanje` ("Kartica (RaiAccept)" → uncheck "Aktivan" → Sačuvaj) until RaiAccept is wired up |
| 7 | Low | ✅ Fixed | Admin order-status dropdown didn't reflect the new value after saving (stale `defaultValue`) |
| 8 | Medium | ✅ Fixed on order-detail page (2026-07-03 follow-up); other pages still pending | Rejected admin form submissions give zero user-facing feedback. Order-detail forms converted to `AdminActionForm`/`useActionState`; the `proizvodi`/`kategorije` bare forms still need the same pass |
| 9 | **High** | ✅ Fixed | MyGLS `PickupDate` sent in wrong date format — broke every shipment-create call before auth even ran |
| 10 | Medium | ✅ Fixed (2026-07-03 follow-up) | Admin courier-create/sync/COD/delete buttons now surface success/error feedback and revalidate on failure (persisted `FAILED` row visible without a hard reload) |
| 11 | **High** | ✅ Fixed (2026-07-03 follow-up) | X Express dictionary sync N+1 — per-row upserts now run in chunked concurrency (20-wide) instead of one awaited call per row, collapsing the ~27+ min town/street runs |
| 12 | **High** | ✅ Fixed | X Express webhook payloads omitting the optional `ReferenceGuid` field were wrongly rejected with 400 (Zod v4 `preprocess`/`optional` ordering bug) |
| 13 | Medium | Not fixed (architectural UI feature) | Admin panel is functionally unusable below ~768px viewport width — sidebar doesn't collapse, main content pushed off-screen with no way to scroll to it |
| 14 | **High** | ✅ Fixed | Admin-initiated order cancellation never restored stock — every manual cancellation permanently "leaked" inventory |
| 15 | Medium | Not fixed (missing UI, needs a design/build decision) | No customer-facing page exists to submit a reclamation, despite `/reklamacije` telling customers to use "Moj nalog → Reklamacije." Backend (`POST /api/reclamations`, presigned photo upload) is fully implemented and verified working end-to-end via direct API calls; nothing in the frontend calls it |

Also worth a look, not a numbered bug: the checkout's final "Potvrdi porudžbinu" step gates on an unchecked `consent` checkbox with no `required` attribute and no visible error — clicking submit with it unchecked silently does nothing (no request, no message). Same family as bugs #8/#10 (silent no-feedback validation) but on the client side.

Full repro steps, root causes, and exact file/line references for every bug are in `QA-FINDINGS.md` (organized by the phase that found them).

## Changes made

All uncommitted, no commits made this session (none requested):

| File | Bug | Risk |
|---|---|---|
| [src/components/layout/header.tsx](src/components/layout/header.tsx) | #1 | Low |
| [src/components/checkout/checkout-flow.tsx](src/components/checkout/checkout-flow.tsx) | #2 | Low — removed `AnimatePresence mode="wait"`, verified 5× on dev+prod builds |
| [src/app/admin/narudzbine/[id]/page.tsx](src/app/admin/narudzbine/%5Bid%5D/page.tsx) | #7, #14 | Low (#7) / Moderate (#14 — touches inventory transactionally, additive + idempotency-guarded, mirrors an already-shipped pattern, verified live 3× this phase |
| [src/lib/mygls/config.ts](src/lib/mygls/config.ts), [client.ts](src/lib/mygls/client.ts), [payload.ts](src/lib/mygls/payload.ts) | #9 | Low — isolated date-formatting helper |
| [src/lib/x-express/webhook.ts](src/lib/x-express/webhook.ts) | #12 | Low — schema-only, made validation more permissive to match the documented-optional field |

Two unrelated pre-existing uncommitted files (`prisma.config.ts`, `svet akcija/finishing touches.md`) predate this QA session and were left untouched.

## Tests added

**None.** The repo has no test runner (no jest/vitest/playwright) — this was flagged in Phase 1 and holds through Phase 5. All verification this session was manual (browser preview + direct DB reads + curl). See [Recommended next steps](#recommended-next-steps).

## Still blocked

| Item | Reason | What's needed |
|---|---|---|
| Social OAuth (Google/Facebook/Apple) | Empty credentials | Real OAuth app credentials |
| Real email sending | `RESEND_API_KEY` placeholder | Real Resend API key, or set `EMAIL_PROVIDER=none` to fall back to dev-log mode until ready |
| IPS payments | `IPS_BASE_URL`/`IPS_USER_ID`/`IPS_TID` placeholders | Real values from the Raiffeisen IPS contract (Bug #5's `getIpsConfig()` URL-validation fix is recommended regardless) |
| Card payments (RaiAccept/WSPay) | Placeholders + `KARTICA.enabled=true` contradicts its own seeded note | Real RaiAccept credentials, or set `KARTICA.enabled=false` until ready (Bug #6) |
| Fiscal provider real calls | Placeholders (`FISCAL_*`) | Real fiscal provider credentials |
| Bulky courier | Empty vars | Dry-run mode only until configured |
| XML supplier import | Not actually blocked — plan's `XML_SUPPLIERS` premise was stale; page is DB-driven and functional, imports simply weren't triggered this session per plan scope |
| Real X Express order announcement | Portal submit API not documented | Real X Express portal API docs, then implement the actual `/api/order/add` POST (currently intentionally local-only) |
| MyGLS real end-to-end verification | Test credentials invalid (storage layer confirmed working) | New/valid MyGLS test (and eventually production) credentials |
| Reclamation submission UI | Page was never built | Build the "Moj nalog → Reklamacije" form (description + up to 5 photos) wired to the already-working `POST /api/reclamations` + `POST /api/reclamations/upload` endpoints (Bug #15) |
| Production webhook URL reachability | Needs a real deploy | Verify `X_EXPRESS_WEBHOOK_*` and cron bearer secrets against the deployed URL post-launch |

## Recommended next steps

1. **Before launch (blocking):** fix the email gap (#4) — right now *no* customer ever receives a confirmation email, silently. Either fill in a real `RESEND_API_KEY` or set `EMAIL_PROVIDER=none` to fall back to safe dev-log mode until ready. (The matching receipt-bucket gap is already resolved — Bug #3.)
2. **Before launch (blocking):** get valid MyGLS test credentials and re-run Phase 4's MyGLS pass end-to-end (PrintLabels → verify → DeleteLabels) — storage is confirmed working, the credentials are the only remaining blocker.
3. **Before launch (product decision):** decide whether reclamations ship at launch without a UI (customers use email only) or the "Moj nalog → Reklamacije" form (Bug #15) gets built first — the backend is ready either way.
4. **Product/architecture decision needed:** X Express real order announcement requires portal API docs that don't exist yet — decide whether X Express ships at launch or MyGLS-only for v1.
5. **Product/architecture decision needed:** per-order courier provider selection (currently global via env var) — recommended fix already scoped above.
6. **When staff mobile/tablet access becomes a real need:** fix Bug #13 (admin responsive layout) — not urgent if admin usage stays desktop-only, but currently a hard blocker if it doesn't.
7. **Process:** add a test runner (vitest is the natural fit for this stack) — there is currently no automated regression coverage for any of the flows this session tested manually, meaning every future change carries the same manual-verification cost this QA pass did.

---
*Full phase-by-phase detail, exact repro steps, server logs, and DB verification for every finding above is preserved in `QA-FINDINGS.md`.*
