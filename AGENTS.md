<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## OS

- dialect: standard (backlog format: `~/.claude/os/BACKLOG-SPEC.md`)
- verify: `npm run build`
- Prisma: the transaction-pooler URL (port 6543) hangs the `prisma migrate` CLI on TLS; on 2026-07-10 the runtime app ALSO hung on it locally (empty `DATABASE_URL` made `src/lib/db.ts` fall through to `POSTGRES_PRISMA_URL`). Remedy in both cases: keep `DATABASE_URL` in `.env.local` set to the `POSTGRES_URL_NON_POOLING` value (port 5432). Don't leave `DATABASE_URL` empty.
- Env gotcha: `.env.local` contains truthy `GET_FROM_*` placeholder secrets — treat them as unset in any "is this configured" logic.
