# Backlog

Format: `~/.claude/os/BACKLOG-SPEC.md`. Sources: QA-REPORT.md, QA-FINDINGS.md,
project memory (badi fiscal state, ERP wiring state). Bug numbers reference
QA-REPORT.md's bug table.

## Phase 1 — launch blockers

- [ ] NEEDS-USER: obtain valid MyGLS test credentials (current ones return "Unauthorized." on every call — blocks label print/status sync end-to-end; storage side already verified working). Then re-run the QA Phase 4 MyGLS pass.
- [ ] NEEDS-USER: get a real RESEND_API_KEY (or empty the placeholder) — order emails currently fail silently against the real API (bug #4).
- [ ] NEEDS-USER: uncheck "Aktivan" for "Kartica (RaiAccept)" at /admin/placanje — card payment is enabled in DB with no gateway configured (bug #6).
- [x] [build] Harden env config checks: treat any env value starting with `GET_FROM_` as unconfigured in every provider fallback (Resend, IPS, courier), so placeholder secrets degrade to dev-mode instead of firing real failing API calls. Accept: with `.env.local` placeholders in place, order flow logs email to console instead of calling Resend, and `npm run build` passes. *(2026-07-06: shared `envValue()` in `src/lib/env.ts`, wired into email/fiscal/IPS/bulky/viber configs; verified at runtime — dispatch logged `[email:dev]` instead of calling Resend; build+lint clean.)*
- [ ] [build] Convert the `proizvodi` and `kategorije` admin bare forms to `AdminActionForm`/`useActionState` so rejected submissions show user-facing feedback, matching the order-detail pattern (bug #8 remainder). Accept: submitting an invalid product/category form shows an inline error; `npm run build` passes.

## Phase 2 — customer-facing gaps

- [ ] [build] Reclamation submission UI under "Moj nalog → Reklamacije": form + photo upload calling the verified `POST /api/reclamations` + presigned-upload backend (bug #15). Accept: logged-in customer submits a reclamation with a photo end-to-end; it appears in admin; `npm run build` passes.
- [ ] [build] Admin responsive layout: collapse the sidebar below 768px so main content is reachable (bug #13). Accept: at 375px viewport, admin orders page is fully navigable; desktop layout unchanged; `npm run build` passes.

## Phase 3 — fiscalization go-live (badi.rs)

- [ ] NEEDS-USER: create badi.rs account and set BADI_API_KEY / BADI_API_SECRET / BADI_CLIENT_ID in .env.local (dev stub in use until then; badi.rs was emailed for full API docs).
- [x] NEEDS-USER: create the `fiscal-receipts` Supabase bucket. *(2026-07-06: created — public, PDF-only, matching `order-receipts`; upload/public-fetch/delete round-trip verified.)*
- [ ] NEEDS-USER: point an external cron scheduler at `/api/cron/fiscal-retry` every ~15 min with bearer CRON_SECRET.
- [ ] NEEDS-USER: ask the accountant whether IPS prepayment legally requires an "advance" receipt + close-at-delivery instead of `normal` at payment time.
- [ ] [build] badi sandbox spike (after creds land): verify `receiptDelivery` response shape, the product-must-preexist assumption, and duplicate-product error text against the real sandbox; fix `src/lib/fiscal/badi.ts` where reality differs. Accept: a sandbox receipt issues successfully and the official PDF lands in the `fiscal-receipts` bucket.
- [ ] [review] Pre-launch release review: fiscal issuance/refund paths, payment methods, checkout order-state machine, courier webhook auth. Accept: verdict SHIP, or BLOCK with a minimum fix list.

## Phase 4 — ERP follow-ups

- [ ] [build] PO PDF generation + send-to-supplier email attachment (send currently only flips status). Accept: sending a PO emails a PDF (console-logged in dev mode) and the PO event trail records it; `npm run build` passes.
- [ ] [build] Transport-cost allocation into BM%/COGS (currently customs-only approximation), per spec §5.1 alongside `src/lib/admin/po.ts`. Accept: receiving a PO with transport costs produces weighted-average COGS that includes freight; `npm run build` passes.
- [ ] [build] Warehouse/lager admin UI over WarehouseStock + StockMovement. Accept: stock levels and movements for a received PO are visible in admin; `npm run build` passes.
- [ ] [build] Dedicated inbound-invoice editor with freight allocation. Accept: an inbound invoice can be edited and posted with freight split across lines; `npm run build` passes.
