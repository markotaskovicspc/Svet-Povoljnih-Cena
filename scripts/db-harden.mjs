import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

/**
 * Supabase security hardening — run after every Prisma migration.
 *
 * Prisma creates tables with RLS disabled, and Supabase's default
 * privileges grant the public `anon`/`authenticated` API roles full CRUD
 * on new tables in `public`. Since the anon key ships in the browser
 * bundle, any table this script misses is world-readable/writable via
 * PostgREST (Supabase advisor: rls_disabled_in_public, 2026-07-12).
 *
 * The app never uses the Data API against `public` — all table access
 * goes through Prisma as `postgres` (bypasses RLS) and storage uses the
 * service-role key — so denying the API roles everything is safe.
 *
 * Wired into db:migrate / db:deploy / db:push in package.json; if you run
 * the prisma CLI directly, run `npm run db:harden` afterwards.
 */

function withSslNoVerify(connectionString) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=no-verify`;
  }
}

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.error("db-harden: no database connection string in env; skipping.");
  process.exit(0);
}

const adapter = new PrismaPg(withSslNoVerify(connectionString));
const db = new PrismaClient({ adapter });

try {
  const before = await db.$queryRawUnsafe(
    "select count(*)::int as n from pg_tables where schemaname='public' and not rowsecurity",
  );

  await db.$executeRawUnsafe(`
    do $$
    declare t record;
    begin
      for t in select tablename from pg_tables where schemaname='public' and not rowsecurity loop
        execute format('alter table public.%I enable row level security', t.tablename);
      end loop;
    end
    $$;
  `);

  // Belt and braces: even an RLS-off table leaks nothing if the API roles
  // hold no grants. Revoke existing grants and the default-privilege
  // entries that would grant them on future tables.
  await db.$executeRawUnsafe(
    "revoke all on all tables in schema public from anon, authenticated",
  );
  await db.$executeRawUnsafe(
    "revoke all on all sequences in schema public from anon, authenticated",
  );
  await db.$executeRawUnsafe(
    "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated",
  );
  await db.$executeRawUnsafe(
    "alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated",
  );

  console.log(
    `db-harden: enabled RLS on ${before[0].n} table(s); revoked anon/authenticated grants on public schema.`,
  );
} finally {
  await db.$disconnect();
}
