# ERP analytics updates

- Global authenticated refresh invalidates the dashboard analytics tag and reloads the current route without dropping filters. Full-screen mobile conversations expose their own top-right refresh.
- Ananas top products replaces the low-stock dashboard panel. Imported marketplace orders are authoritative; linked local orders are excluded to avoid duplicates. The panel explicitly covers all Ananas warehouses.
- Site presence sends a heartbeat every 45 seconds only from visible storefront tabs with analytics consent. A visitor's rotating anonymous ID deduplicates tabs. A 90-second window defines the active count; presence rows expire after 24 hours.
- Traffic notifications are a separate device opt-in in the existing bell panel. The server counts visitors, locks evaluation across instances, and atomically queues device jobs with the hourly cooldown. No polling admin page is required. Cron provides recovery; alerts older than five minutes are dropped. Existing order subscriptions retain their current behavior.
- Daily visits include site orders, Ananas orders, total counts/values, and site conversion. Conversion counts tracked sessions with a valid web purchase divided by tracked sessions that day; Ananas orders never enter site conversion. Belgrade calendar boundaries and Excel export use the same dataset.
- Product performance is WEB merchandise only: issued fiscal sales minus issued refunds, excluding delivery/assembly. The header covers the full participating assortment; search and pagination apply only to the table. Sorting applies to the entire filtered dataset, with unknown values last.
- Available-stock days require consistent owned-stock ledger history. Stock is time weighted. Historical inventory prices are not fully recorded, so average stock value uses current unit COGS and KOZ is explicitly an estimate. Missing sales COGS, gaps in inventory history, unlogged stock changes, and zero denominators display unknown instead of zero. Stock coverage is current positive stock divided by daily sales during known in-stock days. Supplier stock is excluded.

## Release and recovery

The migration adds an opt-in boolean (default false) and an indexed transient presence table with RLS enabled and no anon/authenticated grants. Apply through the existing production `db:deploy` + `db:harden` build chain before the new app serves requests. It is additive and old app versions can coexist; an app rollback can leave these additions intact. No historical business data is backfilled or changed.

## Validation

Unit coverage includes fiscal refunds, missing costs, stock-history coverage, DST days, full-dataset sorting, weighted assortment KOZ, imported-order deduplication, session-based conversion, owner-scoped preferences, consent/origin/rate checks, hourly traffic alert throttling and transactional outbox creation, stale alerts, RLS/grants, refresh authentication and cache freshness.

Local browser checks used the actual ERP and a disposable PGlite database with fictitious orders/products: desktop/mobile layouts, sorting, search, date filters, filter-preserving refresh, Ananas dashboard and report-center links, and OPS access. No real customers were messaged. Physical iPhone keyboard behavior and delivery to a real push device were not exercised.
