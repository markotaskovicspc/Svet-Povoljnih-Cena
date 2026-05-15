# Admin Panel Go-Live Fix Plan

## Current Findings

- Working: Prisma schema validates, TypeScript passes, production build passes with network access, admin routes compile, `/admin` redirects to `/admin/prijava`, bad admin login shows the expected error, Supabase is reachable.
- Live Supabase state: `1` enabled `SUPER` admin, `7` payment configs, `3` ad flags, but `0` products, categories, banners, tabs, orders, suppliers, vouchers, imports, comments, newsletters, Viber campaigns, and audit logs.
- Not working for live admin control: storefront still uses mock/static data in home, PDP, listings, nav, promo bar, cart-related product lookup, and search. Admin CRUD writes to DB, but most storefront pages do not read those DB rows yet.
- Major go-live blockers: no Prisma migrations folder, no real product/catalog data, ERP is local/mock only, uploads are stubbed, payment/delivery admin settings are not used by checkout, action errors are swallowed with no UI feedback, and local Supabase/admin bootstrap files contain sensitive operational credentials that must be rotated/cleaned before launch.
- Current validation gap: authenticated browser click-through was not completed because that would require using/resetting live admin credentials and would mutate live DB login state.

## Step-By-Step Implementation

### 1. Security and Supabase readiness

- Remove plaintext admin password guidance from `svet akcija/supabase-bootstrap.sql`; keep only placeholder instructions and use `scripts/create-admin.mjs` for admin creation/reset.
- Rotate any Supabase service-role/JWT/database/admin credentials that appeared in local files before going live.
- Create a canonical `.env.example` matching actual code names: `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_SERVICE_ROLE_KEY`, `WSPAY_SECRET`, `EMAIL_PROVIDER`, `CRON_SECRET`, `ADMIN_API_SECRET`, etc.
- Add Prisma migrations from `prisma/schema.prisma` and keep Supabase SQL bootstrap as seed-only operational data, not schema source of truth.

### 2. Admin action reliability

- Replace the current `withAdmin(...): Promise<void>` pattern with a typed action result, e.g. `AdminActionState = { ok, message, fieldErrors? }`, so failed validation/database writes show visible errors.
- Add `useActionState` wrappers for admin forms and show success/error feedback consistently.
- Keep authorization inside every Server Action, following Next 16 Server Action security guidance.
- Add confirmation for destructive deletes and handle foreign-key failures with user-readable messages.

### 3. Connect admin-controlled content to storefront

- Add DB read helpers for active `Banner`, `PromoBar`, and `Tab` rows with enabled/date filtering.
- Replace static imports in home/layout/header flows, especially `src/app/page.tsx` and `src/app/layout.tsx`, so admin changes actually affect the live site.
- Revalidate affected storefront routes after admin writes: `/`, promo pages, header/nav, and relevant listing pages.

### 4. Connect catalog/admin product control

- Populate catalog through XML import or controlled seed: products, categories, media, groups, collections, suppliers.
- Replace remaining `mockProducts` usage in PDP, listing pages, search, cart/wishlist lookup, and cross-sell with DB-backed catalog APIs.
- Expand product admin beyond basic overrides: media, category assignment, pictograms/materials, feed-sync ownership flags, and "do not overwrite by XML" controls where needed.
- Make `/admin/akcije`, `/admin/heroji`, `/admin/preporuke`, and `/admin/oglasi` affect real storefront rails/listings/feeds.

### 5. Wire commercial settings into checkout

- Use `PaymentMethodConfig` in checkout payment rendering so `/admin/placanje` controls visible payment methods.
- Use `DeliveryPriceRule` and `DeliveryCity` in shipping/delivery calculation so `/admin/dostava` affects checkout totals.
- Keep vouchers as they are partially wired already, but add admin-side redemption visibility and validation feedback.
- Add tests proving disabled payment methods and delivery rules cannot be bypassed by direct API payloads.

### 6. Operational admin modules

- Orders: keep status updates, but add customer/admin notification hooks and real fiscalization button calling `/api/fiscal/issue` instead of only manually saving receipt number.
- Reclamations: connect status changes to notification emails/SMS/Viber based on customer preference.
- XML import: add mapping validation, test-run preview, per-row error display, and supplier import protection against slug/category collisions.
- Viber: current admin saves campaign drafts; add send/schedule/resend/cancel actions using existing campaign library.
- ERP: mark mock/local modules clearly or replace them with DB-backed persistence before calling ERP "live."

## Public Interfaces / Types

- Add admin action return type shared by all admin forms.
- Add storefront read APIs/helpers: `getActiveBanners`, `getActivePromoBar`, `getActiveTabs`, `getHomeRails`, `getEnabledPaymentMethods`, `resolveDeliveryQuote`.
- Add migration and seed workflow: `prisma/migrations/*`, a safe seed/bootstrap script, and documented Supabase deployment order.
- No new public unauthenticated mutation endpoints; admin mutations stay session-protected, cron/API endpoints stay bearer-secret protected.

## Test Plan

- Run `npx prisma validate`, `npx tsc --noEmit --incremental false`, `npm run build`, and `npm run lint`.
- Fix existing lint blockers before launch: unescaped quote, React Compiler ref/effect issues, and hook-form compiler warning.
- Add admin integration tests for each role: `SUPER`, `CONTENT`, `OPS`, `ADS`, forbidden redirects, and audit logging.
- Add browser smoke tests: login, dashboard, every sidebar route, create/edit/delete for content records, product update, voucher validation, payment toggle, delivery rule, order status, reclamation status, XML supplier save/import.
- Add storefront acceptance tests proving admin changes appear live: banner, promo bar, tab, product price/stock, action listing, payment method visibility, delivery price, voucher discount.
- Add DB readiness check before go-live: at least one admin, payment configs, ad flags, categories, products with media, delivery cities/rules, and one successful XML import run.

## Assumptions

- Goal is a real live admin panel where admin DB changes control the public storefront, checkout, feeds, and operational workflows.
- Supabase Postgres remains the primary database through Prisma.
- Empty catalog/order data is not acceptable for launch; either XML import or a production seed must populate real catalog data first.
- Existing modified admin files are treated as current workspace work and should be preserved, then fixed forward.
