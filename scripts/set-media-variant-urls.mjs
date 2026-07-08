// One-time backfill: read the variants manifest produced by
// `npm run media:variants` and set thumbUrl/cardUrl/pdpUrl on the matching
// ProductMedia rows. Dry-run by default; pass --apply to write.
//
//   node scripts/set-media-variant-urls.mjs [--manifest <path>] [--apply]
//
// Join key: each manifest entry carries `mediaId` (sa-media-*) and
// `sourceStoragePath` (the ORIGINAL object path, e.g. products/1003/001-1.png).
// We match a ProductMedia row by id first, then by comparing the row's `url`
// (normalised to a storage-relative path) against sourceStoragePath. The
// dry-run prints the match breakdown so we can confirm the key before applying.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import {
  resolveConnectionString,
  withSslNoVerify,
} from "./lib/media-variants.mjs";

loadEnv({ path: ".env.local" });
loadEnv();

const args = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(
  args.manifest ??
    "svet akcija/outputs/svet-akcija-product-media-variants.json",
);
const apply = Boolean(args.apply);
const reportPath = args.report
  ? path.resolve(args.report)
  : path.resolve("svet akcija/media-variant-url-report.json");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const groups = groupEntries(manifest.entries || []);
  console.log(
    `Manifest ${path.basename(manifestPath)}: ${manifest.entries?.length ?? 0} variant rows -> ${groups.size} images`,
  );

  const connectionString = resolveConnectionString();
  if (!connectionString) {
    fail("Database connection string is required (DATABASE_URL / POSTGRES_URL_NON_POOLING).");
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg(withSslNoVerify(connectionString)),
    log: ["error"],
  });

  try {
    const media = await prisma.productMedia.findMany({
      select: { id: true, url: true, thumbUrl: true, cardUrl: true, pdpUrl: true },
    });
    const byId = new Map(media.map((m) => [m.id, m]));
    const byPath = new Map();
    for (const m of media) {
      const rel = storageRelativePath(m.url);
      if (rel && !byPath.has(rel)) byPath.set(rel, m);
    }

    const stats = { total: groups.size, byId: 0, byPath: 0, unmatched: 0, updated: 0, skipped: 0 };
    const unmatched = [];
    const updates = [];

    for (const group of groups.values()) {
      let row = byId.get(group.mediaId);
      let matchedBy = "id";
      if (!row) {
        row = byPath.get(storageRelativePath(group.sourceStoragePath));
        matchedBy = "path";
      }
      if (!row) {
        stats.unmatched += 1;
        unmatched.push(group);
        continue;
      }
      stats[matchedBy === "id" ? "byId" : "byPath"] += 1;

      const already =
        row.thumbUrl === group.thumbUrl &&
        row.cardUrl === group.cardUrl &&
        row.pdpUrl === group.pdpUrl;
      if (already) {
        stats.skipped += 1;
        continue;
      }
      updates.push({ id: row.id, data: variantData(group) });
    }

    console.log(
      `Matched by id=${stats.byId}, by path=${stats.byPath}, unmatched=${stats.unmatched}, already-set=${stats.skipped}, to-update=${updates.length}`,
    );
    if (unmatched.length) {
      console.log(
        `  first unmatched: mediaId=${unmatched[0].mediaId} sourceStoragePath=${unmatched[0].sourceStoragePath}`,
      );
    }

    if (!apply) {
      console.log("Dry-run: no rows written. Re-run with --apply to persist.");
    } else {
      if (stats.byId === 0 && stats.byPath === 0) {
        fail("Refusing to apply: zero rows matched. Verify the join key / manifest.");
      }
      for (const u of updates) {
        await prisma.productMedia.update({ where: { id: u.id }, data: u.data });
        stats.updated += 1;
      }
      console.log(`Applied ${stats.updated} updates.`);
    }

    await writeFile(
      reportPath,
      JSON.stringify({ apply, manifestPath, stats, unmatched }, null, 2),
    );
    console.log(`Report -> ${reportPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Collapse the 3 per-variant rows for one source image into one record. */
function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.mediaId || entry.sourceStoragePath;
    let group = groups.get(key);
    if (!group) {
      group = {
        mediaId: entry.mediaId,
        sourceStoragePath: entry.sourceStoragePath,
      };
      groups.set(key, group);
    }
    if (entry.variant === "thumb") group.thumbUrl = entry.storagePath;
    if (entry.variant === "card") group.cardUrl = entry.storagePath;
    if (entry.variant === "pdp") group.pdpUrl = entry.storagePath;
  }
  return groups;
}

function variantData(group) {
  const data = {};
  if (group.thumbUrl) data.thumbUrl = group.thumbUrl;
  if (group.cardUrl) data.cardUrl = group.cardUrl;
  if (group.pdpUrl) data.pdpUrl = group.pdpUrl;
  return data;
}

/**
 * Normalise a stored `url` to a bucket-relative path so it can be compared to
 * a manifest sourceStoragePath. Handles both bare relative paths
 * ("products/1003/001-1.png") and full public URLs
 * (".../object/public/product-media/products/1003/001-1.png").
 */
function storageRelativePath(value) {
  if (!value) return "";
  let v = String(value).trim();
  const marker = v.match(/\/object\/(?:public\/)?[^/]+\//);
  if (marker) v = v.slice(marker.index + marker[0].length);
  try {
    v = decodeURIComponent(v);
  } catch {
    // leave as-is if it isn't valid percent-encoding
  }
  return v.replace(/^\/+/, "");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--manifest") out.manifest = argv[++i];
    else if (arg === "--report") out.report = argv[++i];
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
