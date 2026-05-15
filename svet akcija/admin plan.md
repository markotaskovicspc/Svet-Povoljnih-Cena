# Fix Admin Panel Runtime Errors

## Summary

- The pulled code builds successfully and all admin routes exist.
- `svet akcija/supabase-prisma-schema.sql` already matches `prisma/schema.prisma` exactly, so no schema SQL change is needed.
- The real blocker is env/database wiring: the root app `.env.local` does not contain the Supabase Postgres connection vars, while the nested `svet akcija/.env.local` does. Next runs from the repo root, so regular admin pages cannot reliably reach the database.
- The checked Supabase database already has the main tables plus bootstrap rows: 1 admin user, 7 payment method configs, and 3 ad flags.

## Key Changes

- Move the chosen nested Supabase database config into the root `.env.local`, without changing secret values in code:
  - include Postgres connection vars used by `src/lib/db.ts`
  - align public Supabase URL/key and service role with the same project
  - keep root `AUTH_SECRET`
- Update admin access so `/admin/erp` no longer bypasses login. All `/admin/*` pages should require a real admin session, except `/admin/prijava`.
- Replace the dashboard's `!process.env.DATABASE_URL` preview check with the same connection-source logic used by `src/lib/db.ts`, so `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, or `POSTGRES_URL_NON_POOLING` count as a real DB connection.
- Leave `supabase-prisma-schema.sql` unchanged.
- Keep `supabase-bootstrap.sql` mostly unchanged, but make it the clear canonical bootstrap file for:
  - admin user
  - payment methods
  - ad flags
  Add only comments/instructions if needed; do not seed fake products/orders/categories unless explicitly requested.

## Test Plan

- Run `npm run build`; expected: passes.
- Run `npm run lint`; current lint has unrelated existing frontend errors, so admin fix should not introduce new lint errors.
- Start dev server from repo root and verify:
  - `/admin/prijava` loads
  - login with seeded admin works
  - `/admin` dashboard loads without error
  - every sidebar route opens: content, catalog, commercial, operations, marketing, analytics
  - `/admin/erp` and `/admin/erp/artikli` require login and load after login
- Verify read-only DB health:
  - required tables exist
  - bootstrap row counts are present
  - empty catalog/order tables show empty states, not error pages

## Assumptions

- Use the nested Supabase project as the source of truth.
- All admin sections, including ERP, should require login.
- The current empty product/order/category data is acceptable for now; the immediate goal is "pages work without crashing," not full production catalog seeding.
