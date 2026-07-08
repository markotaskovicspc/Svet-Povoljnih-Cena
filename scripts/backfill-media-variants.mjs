// Decoupled variant worker — the reusable engine that keeps every product
// image optimized regardless of how it was imported. It finds ProductMedia
// image rows missing any variant, fetches the source, generates the 3 WebP
// variants, uploads them to Supabase, and writes the relative paths back.
//
// Because it reads the DB as the source of truth, the import code
// (src/lib/xml/import.ts, scripts/import-book12-products.mjs) needs no changes:
// imports just store the source url, this worker backfills variants after.
//
//   node scripts/backfill-media-variants.mjs [--limit N] [--concurrency N]
//                                            [--source-dir <dir>] [--dry-run]
//
// Idempotent / resumable: only rows still missing a variant are picked up, and
// variants are set on success, so a partial run is fixed by re-running.

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import {
  assertPublicHttpUrl,
  generateAndUploadVariants,
  publicStorageUrl,
  resolveConnectionString,
  resolveStorageConfig,
  withSslNoVerify,
} from "./lib/media-variants.mjs";

loadEnv({ path: ".env.local" });
loadEnv();

// Guardrail against pathological sources; override with MAX_SOURCE_MB for
// catalogs with legitimately large originals.
const MAX_SOURCE_BYTES =
  (Number.parseInt(process.env.MAX_SOURCE_MB || "", 10) || 40) * 1024 * 1024;

const args = parseArgs(process.argv.slice(2));
const limit = args.limit ?? 200;
const concurrency = Math.max(1, args.concurrency ?? 6);
const dryRun = Boolean(args.dryRun);
const sourceDir = args.sourceDir ? path.resolve(args.sourceDir) : null;
const reportPath = args.report
  ? path.resolve(args.report)
  : path.resolve("svet akcija/media-variant-backfill-report.json");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const storage = resolveStorageConfig();
  if (!storage) {
    fail(
      "Supabase storage is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). " +
        "Placeholder GET_FROM_* values count as unset.",
    );
  }

  const connectionString = resolveConnectionString();
  if (!connectionString) {
    fail("Database connection string is required (DATABASE_URL / POSTGRES_URL_NON_POOLING).");
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg(withSslNoVerify(connectionString)),
    log: ["error"],
  });

  try {
    const rows = await prisma.productMedia.findMany({
      where: {
        kind: "IMAGE",
        OR: [{ thumbUrl: null }, { cardUrl: null }, { pdpUrl: null }],
      },
      select: { id: true, productId: true, url: true },
      orderBy: { id: "asc" },
      take: limit,
    });

    console.log(
      `Found ${rows.length} image row(s) missing variants (limit ${limit}, concurrency ${concurrency})${dryRun ? " [dry-run]" : ""}.`,
    );
    if (rows.length === 0) return;
    if (dryRun) {
      for (const row of rows.slice(0, 10)) {
        console.log(`  would process ${row.id} <- ${row.url}`);
      }
      console.log("Dry-run: nothing fetched or written.");
      return;
    }

    const stats = { total: rows.length, done: 0, failed: 0 };
    const failures = [];
    let cursor = 0;

    async function runWorker() {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        try {
          await processRow(prisma, storage, row);
          stats.done += 1;
          if (stats.done % 25 === 0 || stats.done + stats.failed === rows.length) {
            console.log(`Processed ${stats.done + stats.failed}/${rows.length}`);
          }
        } catch (error) {
          stats.failed += 1;
          failures.push({ id: row.id, url: row.url, error: String(error?.message || error) });
          console.error(`FAILED ${row.id} (${row.url}): ${error?.message || error}`);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, rows.length) }, runWorker),
    );

    console.log(`Done. Updated: ${stats.done}. Failed: ${stats.failed}.`);
    await writeFile(reportPath, JSON.stringify({ stats, failures }, null, 2));
    console.log(`Report -> ${reportPath}`);
    if (stats.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function processRow(prisma, storage, row) {
  const source = await loadSource(storage, row.url);
  // Synthetic, collision-free storage base per media row. Variants land at
  // variants/{thumb|card|pdp}/products/<productId>/<mediaId>-{width}.webp
  const storageBase = `products/${row.productId}/${row.id}`;
  const variantUrls = await generateAndUploadVariants(storage, source, storageBase);
  await prisma.productMedia.update({ where: { id: row.id }, data: variantUrls });
}

/**
 * Fetch the source image bytes. Prefers a local file under --source-dir when
 * the url is a bucket-relative path and the file exists (avoids re-downloading
 * originals); otherwise downloads over http(s).
 */
async function loadSource(storage, url) {
  if (!url) throw new Error("empty url");

  const isRemote = /^https?:\/\//i.test(url);
  if (!isRemote && sourceDir) {
    const local = path.join(sourceDir, url.replace(/^\/+/, ""));
    try {
      await stat(local);
      return await readFile(local);
    } catch {
      // fall through to download
    }
  }

  const fetchUrl = isRemote ? url : publicStorageUrl(storage, url);
  if (!/^https?:\/\//i.test(fetchUrl)) {
    throw new Error(`cannot resolve a fetchable URL from "${url}"`);
  }
  assertPublicHttpUrl(fetchUrl);
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`download ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`unexpected content-type "${contentType}"`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("empty download");
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error(`source too large (${buffer.length} bytes)`);
  }
  return buffer;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--limit") out.limit = Number.parseInt(argv[++i], 10);
    else if (arg === "--concurrency") out.concurrency = Number.parseInt(argv[++i], 10);
    else if (arg === "--source-dir") out.sourceDir = argv[++i];
    else if (arg === "--report") out.report = argv[++i];
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
