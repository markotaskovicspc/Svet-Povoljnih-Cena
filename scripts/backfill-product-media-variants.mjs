import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

loadEnv({ path: ".env.local" });
loadEnv();

const VARIANTS = [
  { field: "thumbUrl", name: "thumb", width: 160, quality: 76 },
  { field: "cardUrl", name: "card", width: 640, quality: 78 },
  { field: "pdpUrl", name: "pdp", width: 1280, quality: 82 },
];
const CACHE_CONTROL = "31536000";
const apply = process.argv.includes("--apply");
const repairCache = process.argv.includes("--repair-cache");
const limit = optionInt("limit", Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
const concurrency = optionInt("concurrency", 2, 1, 2);

const connectionString = withDatabaseSsl(getConnectionString());
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
    max: concurrency,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  }),
});
const supabaseUrl = envValue("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = envValue("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRole) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
const bucket =
  envValue("NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET") ||
  envValue("SUPABASE_STORAGE_BUCKET") ||
  "product-media";
const storage = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
}).storage.from(bucket);

try {
  const rows = await prisma.productMedia.findMany({
    where: {
      kind: "IMAGE",
      syncStatus: "READY",
      OR: [{ thumbUrl: null }, { cardUrl: null }, { pdpUrl: null }],
    },
    orderBy: [{ productId: "asc" }, { order: "asc" }, { id: "asc" }],
    select: {
      id: true,
      productId: true,
      url: true,
      thumbUrl: true,
      cardUrl: true,
      pdpUrl: true,
      width: true,
      height: true,
    },
  });
  const candidates = rows
    .map((row) => ({ ...row, sourceKey: managedStorageKey(row.url) }))
    .filter((row) => row.sourceKey)
    .slice(0, limit);
  const skipped = rows.length - rows.filter((row) => managedStorageKey(row.url)).length;
  const cacheCandidates = await referencedVariantCacheCandidates();

  console.log(
    [
      `Product media optimization (${apply ? "apply" : "dry-run"})`,
      `variantCandidates=${candidates.length}`,
      `unmanagedSkipped=${skipped}`,
      `legacyCacheCandidates=${cacheCandidates.length}`,
      `repairCache=${repairCache}`,
      `concurrency=${concurrency}`,
    ].join("\n"),
  );
  for (const candidate of candidates.slice(0, 10)) {
    console.log(`  ${candidate.id}: ${candidate.sourceKey}`);
  }

  if (!apply) {
    console.log(
      "Dry-run only. Use --apply to build missing variants; add --repair-cache to refresh referenced legacy cache metadata.",
    );
  } else {
    const backfillResult = await runPool(candidates, concurrency, backfillMediaRow, "variants");
    console.log(
      `Variant backfill complete: updated=${backfillResult.ok} failed=${backfillResult.failed}.`,
    );

    let cacheResult = { ok: 0, failed: 0 };
    if (repairCache) {
      cacheResult = await runPool(
        cacheCandidates,
        concurrency,
        repairObjectCacheMetadata,
        "cache metadata",
      );
      console.log(
        `Cache metadata repair complete: updated=${cacheResult.ok} failed=${cacheResult.failed}.`,
      );
    }
    if (backfillResult.failed || cacheResult.failed) process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

async function backfillMediaRow(row) {
  const sourceKey = row.sourceKey;
  const { data, error } = await storage.download(sourceKey);
  if (error || !data) {
    throw new Error(`download failed for ${sourceKey}: ${error?.message || "missing object"}`);
  }
  const source = Buffer.from(await data.arrayBuffer());
  const metadata = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 80_000_000,
  }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`missing dimensions for ${sourceKey}`);
  }
  const swapsDimensions = metadata.orientation !== undefined && metadata.orientation >= 5;
  const uploaded = [];
  const update = {};

  try {
    for (const variant of VARIANTS) {
      if (row[variant.field]) continue;
      const key = variantKey(sourceKey, variant);
      const buffer = await sharp(source, {
        failOn: "warning",
        limitInputPixels: 80_000_000,
      })
        .rotate()
        .resize({
          width: variant.width,
          height: variant.width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: variant.quality, effort: 4 })
        .toBuffer();
      const { error: uploadError } = await storage.upload(key, buffer, {
        cacheControl: CACHE_CONTROL,
        contentType: "image/webp",
        upsert: true,
      });
      if (uploadError) throw new Error(`upload failed for ${key}: ${uploadError.message}`);
      uploaded.push(key);
      update[variant.field] = key;
    }

    if (row.width === null) {
      update.width = swapsDimensions ? metadata.height : metadata.width;
    }
    if (row.height === null) {
      update.height = swapsDimensions ? metadata.width : metadata.height;
    }
    const result = await prisma.productMedia.updateMany({
      where: {
        id: row.id,
        OR: [{ thumbUrl: null }, { cardUrl: null }, { pdpUrl: null }],
      },
      data: update,
    });
    if (result.count !== 1) {
      throw new Error(`database row ${row.id} changed during backfill`);
    }
  } catch (error) {
    if (uploaded.length) await storage.remove(uploaded);
    throw error;
  }
}

async function referencedVariantCacheCandidates() {
  return prisma.$queryRawUnsafe(`
    SELECT DISTINCT referenced.name,
      COALESCE(objects.metadata->>'mimetype', 'image/webp') AS "contentType"
    FROM "ProductMedia" AS media
    CROSS JOIN LATERAL (
      VALUES (media."thumbUrl"), (media."cardUrl"), (media."pdpUrl")
    ) AS referenced(name)
    JOIN storage.objects AS objects
      ON objects.bucket_id = '${sqlLiteral(bucket)}'
      AND objects.name = referenced.name
    WHERE referenced.name IS NOT NULL
      AND objects.metadata->>'cacheControl' IS DISTINCT FROM 'max-age=31536000'
    ORDER BY referenced.name
  `);
}

async function repairObjectCacheMetadata(row) {
  const { data, error } = await storage.download(row.name);
  if (error || !data) {
    throw new Error(`download failed for ${row.name}: ${error?.message || "missing object"}`);
  }
  const body = Buffer.from(await data.arrayBuffer());
  const { error: uploadError } = await storage.upload(row.name, body, {
    cacheControl: CACHE_CONTROL,
    contentType: data.type || row.contentType || "image/webp",
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`cache metadata upload failed for ${row.name}: ${uploadError.message}`);
  }
}

async function runPool(items, size, worker, label) {
  let cursor = 0;
  let ok = 0;
  let failed = 0;
  const failures = [];
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        await worker(items[index]);
        ok += 1;
      } catch (error) {
        failed += 1;
        failures.push(error instanceof Error ? error.message : String(error));
      }
      const completed = ok + failed;
      if (completed % 25 === 0 || completed === items.length) {
        console.log(`${label}: ${completed}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
  return { ok, failed };
}

function variantKey(sourceKey, variant) {
  const parsed = path.posix.parse(sourceKey.replace(/^\/+/, ""));
  const sourceBase = path.posix.join(parsed.dir, parsed.name);
  return path.posix.join(
    "variants",
    variant.name,
    `${sourceBase}-${variant.width}.webp`,
  );
}

function managedStorageKey(value) {
  if (!value || /^(data:|blob:)/.test(value) || value.startsWith("/")) return null;
  if (!/^https?:\/\//.test(value)) return value.replace(/^\/+/, "");
  try {
    const url = new URL(value);
    if (url.origin !== new URL(supabaseUrl).origin) return null;
    const prefixes = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
    ];
    const prefix = prefixes.find((candidate) => url.pathname.startsWith(candidate));
    if (!prefix) return null;
    return url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function optionInt(name, fallback, min, max) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function envValue(name) {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("GET_FROM_") ? value : null;
}

function getConnectionString() {
  const value = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((candidate) => candidate?.trim());
  if (!value) throw new Error("A database connection string is required.");
  const url = new URL(value);
  if (url.port === "6543") {
    throw new Error("Refusing the transaction-pooler endpoint; use the port 5432 URL.");
  }
  return value;
}

function withDatabaseSsl(value) {
  const url = new URL(value);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return value;
  const sslMode =
    process.env.DATABASE_SSLMODE?.trim() || url.searchParams.get("sslmode") || "require";
  url.searchParams.set("sslmode", sslMode);
  if (["prefer", "require", "verify-ca"].includes(sslMode.toLowerCase())) {
    url.searchParams.set("uselibpqcompat", "true");
  }
  return url.toString();
}

function sqlLiteral(value) {
  return value.replaceAll("'", "''");
}
