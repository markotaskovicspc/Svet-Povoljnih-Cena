<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## OS

- dialect: standard (backlog format: `~/.claude/os/BACKLOG-SPEC.md`)
- verify: `npm run build`
- Prisma CLI (migrations): set `DATABASE_URL` from `POSTGRES_URL_NON_POOLING` first — the pooler URL hangs `prisma migrate` on TLS (runtime app is unaffected).
- Env gotcha: `.env.local` contains truthy `GET_FROM_*` placeholder secrets — treat them as unset in any "is this configured" logic.
