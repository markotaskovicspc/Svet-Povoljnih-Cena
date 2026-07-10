# Backlog

Format: `~/.claude/os/BACKLOG-SPEC.md`. Sources: QA-REPORT.md, QA-FINDINGS.md,
project memory (badi fiscal state, ERP wiring state). Bug numbers reference
QA-REPORT.md's bug table.

## Phase 1 — launch blockers

- [x] NEEDS-USER: obtain valid MyGLS test credentials. *(2026-07-10: RESOLVED by MyGLS answer — no test env exists for COD; our creds are production creds, valid since Client ID issuance. Testing happens directly in production: created labels are inert until a pickup is announced (najava ≥24h ahead). `MYGLS_ENV=production` set in .env.local; controlled production pass replaces the old test pass — see the [build] item below.)*
- [ ] [build] MyGLS controlled production pass: master-data sync auth check, create shipment for a clearly-marked test COD order, label PDF in `shipment-labels`, status sync, then delete labels via `deleteMyGlsLabelsForShipment`. NO pickup announcement. Accept: full create→verify→delete loop against api.mygls.rs recorded in QA-FINDINGS.md with parcel numbers; no dangling labels. *(2026-07-10 attempt blocked: runtime pooler TLS hang — fixed, DATABASE_URL now non-pooling; and MYGLS_PICKUP_* is placeholder — waits on the real-pickup-address NEEDS-USER item below. Credential validity in production still unverified.)*
- [ ] NEEDS-USER: real MyGLS pickup address + contact for `MYGLS_PICKUP_*` in .env.local (still "Test ulica 1, Beograd" / test contact) — required before the first real pickup najava; ask MyGLS how najava is performed (portal/email/API).
- [ ] [build] IPS callback route to Payten PGW spec: callback is an unsigned JSON POST — treat as untrusted wake-up ping, gate on pending IPS payment, verify via server→gateway `checkStatus`, always answer 200; remove invented HMAC machinery; rate-limit per-IP/per-order; token-expiry clamp + 401 retry. Accept: `npm run build` green; forged callback with random orderId → 200 with no gateway call and no DB change; real path funnels through `checkPaymentStatus`.
- [ ] NEEDS-USER: reply on the Payten/Raiffeisen thread with merchant logo (`public/logo.jpeg`) + testing IP 178.221.225.75 for whitelist (draft prepared 2026-07-10); wait for whitelist confirmation.
- [ ] [build] IPS test-PGW end-to-end pass (after whitelist): pre-flight `generateToken` curl (record `tokenExpiryTime` units), order → QR redirect → pay in test env → PAID/POTVRDJENO + fiscal + email side-effects, negative paths (cancel/fail/forged/replayed callback), full + partial refund. Callback leg via public tunnel in `IPS_PUBLIC_BASE_URL`. Accept: all steps recorded in QA-FINDINGS.md; watch for non-"00" in-progress responseCodes transiently flipping PENDING→FAILED (add allowlist if the test PGW uses them).
- [x] [build] IPS site-compliance sweep per "Uputstvo za rad IPS internet prodajnog mesta". *(2026-07-10: all 8 points verified/fixed — legal name corrected to registered form, fake MB 20000000 → real 22112597 in `src/lib/merchant.ts`, added šifra delatnosti 4791, "kada se zadužuje račun" section on uslovi-isporuke, IPS-exclusive refund statement on reklamacije; PDV note, logo placements, order specification already OK.)*
- [ ] NEEDS-USER: real PIB — `src/lib/merchant.ts` still holds placeholder `100000000`, which feeds fiscal receipts, order emails, and legal pages (single constant; also needed for `FISCAL_TIN` env). Get it from company registration (APR) and update that one file + env.
- [ ] NEEDS-USER: real bank account + bank name — `src/lib/merchant.ts` has placeholder `160-000000-00` / "Banca Intesa"; the Payten email lists račun `265331031000537534` (Raiffeisen). Confirm official formatted account number and update.
- [ ] NEEDS-USER: get a real RESEND_API_KEY (or empty the placeholder) — order emails currently fail silently against the real API (bug #4).
- [ ] NEEDS-USER: X Express still silent on the najava-specifikacija + webhook-registration email (contract U000328) — if no reply by 2026-07-14, send a follow-up nudge. `/api/order/add` stays stubbed until their spec lands.
- [ ] NEEDS-USER: uncheck "Aktivan" for "Kartica (RaiAccept)" at /admin/placanje — card payment is enabled in DB with no gateway configured (bug #6).
- [x] [build] Harden env config checks: treat any env value starting with `GET_FROM_` as unconfigured in every provider fallback (Resend, IPS, courier), so placeholder secrets degrade to dev-mode instead of firing real failing API calls. Accept: with `.env.local` placeholders in place, order flow logs email to console instead of calling Resend, and `npm run build` passes. *(2026-07-06: shared `envValue()` in `src/lib/env.ts`, wired into email/fiscal/IPS/bulky/viber configs; verified at runtime — dispatch logged `[email:dev]` instead of calling Resend; build+lint clean.)*
- [ ] [build] Convert the `proizvodi` and `kategorije` admin bare forms to `AdminActionForm`/`useActionState` so rejected submissions show user-facing feedback, matching the order-detail pattern (bug #8 remainder). Accept: submitting an invalid product/category form shows an inline error; `npm run build` passes.

## Phase 2 — customer-facing gaps

- [ ] [build] Reclamation submission UI under "Moj nalog → Reklamacije": form + photo upload calling the verified `POST /api/reclamations` + presigned-upload backend (bug #15). Accept: logged-in customer submits a reclamation with a photo end-to-end; it appears in admin; `npm run build` passes.
- [ ] [build] Admin responsive layout: collapse the sidebar below 768px so main content is reachable (bug #13). Accept: at 375px viewport, admin orders page is fully navigable; desktop layout unchanged; `npm run build` passes.

## Phase 3 — fiscalization go-live (badi.rs)

- [ ] NEEDS-USER: badi.rs account CREATED (2026-07-10) — paste BADI_API_KEY / BADI_API_SECRET / BADI_CLIENT_ID from the badi dashboard into the empty block in .env.local, then set FISCAL_PROVIDER=badi (keep BADI_ENV=sandbox until the spike passes).
- [x] NEEDS-USER: create the `fiscal-receipts` Supabase bucket. *(2026-07-06: created — public, PDF-only, matching `order-receipts`; upload/public-fetch/delete round-trip verified.)*
- [ ] NEEDS-USER: point an external cron scheduler at `/api/cron/fiscal-retry` every ~15 min with bearer CRON_SECRET.
- [x] NEEDS-USER: ask the accountant whether IPS prepayment legally requires an "advance" receipt + close-at-delivery instead of `normal` at payment time. *(2026-07-10: ANSWERED — "najkonformnije je da se odmah izda konačan račun, a kod povraćaja refundacioni račun." Final receipt at payment + refund receipt on returns = exactly current behavior (`invoiceType: "normal"` on IPS confirmation, refunds via /admin/fiskalizacija). No advance-receipt flow needed; no code change.)*
- [ ] [build] badi sandbox spike (after creds land): verify `receiptDelivery` response shape, the product-must-preexist assumption, and duplicate-product error text against the real sandbox; fix `src/lib/fiscal/badi.ts` where reality differs. Accept: a sandbox receipt issues successfully and the official PDF lands in the `fiscal-receipts` bucket.
- [ ] [review] Pre-launch release review: fiscal issuance/refund paths, payment methods, checkout order-state machine, courier webhook auth. Accept: verdict SHIP, or BLOCK with a minimum fix list.

## Phase 4 — ERP follow-ups

- [ ] [build] PO PDF generation + send-to-supplier email attachment (send currently only flips status). Accept: sending a PO emails a PDF (console-logged in dev mode) and the PO event trail records it; `npm run build` passes.
- [ ] [build] Transport-cost allocation into BM%/COGS (currently customs-only approximation), per spec §5.1 alongside `src/lib/admin/po.ts`. Accept: receiving a PO with transport costs produces weighted-average COGS that includes freight; `npm run build` passes.
- [ ] [build] Warehouse/lager admin UI over WarehouseStock + StockMovement. Accept: stock levels and movements for a received PO are visible in admin; `npm run build` passes.
- [ ] [build] Dedicated inbound-invoice editor with freight allocation. Accept: an inbound invoice can be edited and posted with freight split across lines; `npm run build` passes.
