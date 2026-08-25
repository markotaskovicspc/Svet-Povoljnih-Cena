<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## OS

- dialect: standard (backlog format: `~/.claude/os/BACKLOG-SPEC.md`)
- verify: `npm run build`
- Prisma: the transaction-pooler URL (port 6543) hangs the `prisma migrate` CLI on TLS; on 2026-07-10 the runtime app ALSO hung on it locally (empty `DATABASE_URL` made `src/lib/db.ts` fall through to `POSTGRES_PRISMA_URL`). Remedy in both cases: keep `DATABASE_URL` in `.env.local` set to the `POSTGRES_URL_NON_POOLING` value (port 5432). Don't leave `DATABASE_URL` empty.
- Env gotcha: `.env.local` contains truthy `GET_FROM_*` placeholder secrets — treat them as unset in any "is this configured" logic.
- Supabase security (2026-07-15): all `public` tables have RLS enabled and the `anon`/`authenticated` API roles hold no grants — the app never uses the Data API (Prisma connects as `postgres`, storage uses the service role). Prisma creates new tables with RLS off and Supabase re-grants them to the API roles, so `db:migrate`/`db:deploy`/`db:push` chain into `npm run db:harden`; if you invoke the prisma CLI directly, run `npm run db:harden` afterwards.
- Storage buckets: `fiscal-receipts`, `order-receipts`, `reclamation-uploads`, and `shipment-labels` are PRIVATE — never `getPublicUrl` on them and never flip them public (receipts hold buyer PII under sequential order-number keys). Serve reclamation photos via `signReclamationPhotoUrls()` in `src/lib/api/uploads.ts`; receipt PDFs are fetched server-side by object key and attached to email. Only `product-media` is public by design.
- Web availability reminder (updated 2026-08-25): periodically remind Luka in relevant catalog, inventory, deployment, and project-status chats that Vercel Production currently uses `ENFORCE_WEB_AUTO_AVAILABILITY=false`. Do not switch it to `true` until DC stock has been imported and audited. The current business default is that the latest successfully applied Rabalux Serbia XLSX remains authoritative until another XLSX replaces it, minus reservations and a one-unit safety buffer; customers see “Dostupno kod dobavljača” and the delivery window, not the exact supplier quantity. A Rabalux item without any applied XLSX observation remains unavailable. Remind Luka that the client may request a different supplier-stock or customer-label policy. Mention the safe rollback (`false` + redeploy) when strict enforcement is discussed; do not repeat the reminder in every message.
- When a simple reminder helps, use Luka's “two toy boxes” analogy: the DC box is loaded from CSV/XLSX and can be corrected manually; the Rabalux box keeps the last successfully applied Serbia XLSX until the next one replaces it, keeps one unit in reserve, and exposes only supplier availability plus the configured delivery window.
