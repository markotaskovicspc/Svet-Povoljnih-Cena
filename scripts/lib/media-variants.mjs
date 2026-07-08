// Shared engine for product-image variant generation + Supabase upload.
//
// Single source of truth for the variant sizes/quality and the
// generate -> upload -> storage-path logic, imported by every entry point:
//   - svet akcija/outputs/build-product-media-variants.mjs  (local-file batch)
//   - scripts/set-media-variant-urls.mjs                    (DB backfill of the 892)
//   - scripts/backfill-media-variants.mjs                   (decoupled worker)
//   - src/app/api/cron/media-variants/route.ts              (optional cron)
//
// Keeping this in one place is what stops the initial backfill and the ongoing
// worker from drifting apart on sizes, quality, or storage layout.

import path from "node:path";
import sharp from "sharp";

// The three rendered sizes. Widths match the responsive `sizes` attributes in
// product-card.tsx (card) and pdp-gallery.tsx (pdp); thumb feeds cart/search/
// wishlist previews. WebP is universally supported; AVIF would be smaller but
// far slower to encode — add a `{ format: "avif" }` here if we ever want it.
export const VARIANTS = [
  { name: "thumb", width: 160, quality: 76 },
  { name: "card", width: 640, quality: 78 },
  { name: "pdp", width: 1280, quality: 82 },
];

export const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export function mimeTypeForExtension(ext) {
  return MIME_TYPES.get(ext.toLowerCase()) || "application/octet-stream";
}

/**
 * Build the storage path for a variant, mirroring the layout the original
 * uploader used: `variants/{thumb|card|pdp}/{originalBaseNoExt}-{width}.webp`.
 *
 * `sourceStoragePath` is the ORIGINAL object path, e.g.
 *   "products/1003/001-1.png"  ->  "variants/card/products/1003/001-1-640.webp"
 */
export function variantStoragePath(sourceStoragePath, variantName, width) {
  const parsed = path.posix.parse(toPosix(sourceStoragePath));
  const base = path.posix.join(parsed.dir, parsed.name);
  return path.posix.join(
    "variants",
    variantName,
    `${base}-${width}.webp`,
  );
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}

/**
 * Generate all variant buffers from an in-memory source image.
 * `source` is a Buffer (worker: downloaded bytes) or a file path (batch script).
 * Returns [{ name, width, quality, buffer }] for the sizes the source supports
 * (withoutEnlargement means tiny sources still produce a — possibly identical —
 * variant, so callers always get one entry per VARIANT).
 */
export async function generateVariants(source, { variants = VARIANTS } = {}) {
  const out = [];
  for (const variant of variants) {
    const buffer = await sharp(source, { failOn: "none" })
      .rotate()
      .resize({
        width: variant.width,
        height: variant.width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: variant.quality, effort: 5 })
      .toBuffer();
    out.push({ ...variant, buffer });
  }
  return out;
}

/**
 * Upload a single object to Supabase Storage via the REST API (upsert).
 * Returns the storage path on success; throws after `attempts` retries.
 */
export async function uploadObject(
  { supabaseUrl, serviceRoleKey, bucket },
  storagePath,
  body,
  { contentType = "application/octet-stream", attempts = 3 } = {},
) {
  const uploadUrl = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${storagePath}`;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": contentType,
          "x-upsert": "true",
        },
        body,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
      }
      return storagePath;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Full pipeline for one image: generate the 3 WebP variants from `source` and
 * upload each to Supabase. Returns { thumbUrl, cardUrl, pdpUrl } as the
 * RELATIVE storage paths (the app's resolveSupabaseStorageUrl adds the CDN
 * prefix; DB columns store the relative path).
 */
export async function generateAndUploadVariants(
  storageConfig,
  source,
  sourceStoragePath,
  { attempts = 3 } = {},
) {
  const generated = await generateVariants(source);
  const result = {};
  for (const variant of generated) {
    const storagePath = variantStoragePath(
      sourceStoragePath,
      variant.name,
      variant.width,
    );
    await uploadObject(storageConfig, storagePath, variant.buffer, {
      contentType: "image/webp",
      attempts,
    });
    result[`${variant.name}Url`] = storagePath;
  }
  return result;
}

/**
 * Read Supabase storage credentials from the environment, treating the
 * `GET_FROM_*` placeholders in .env.local as unset (mirrors src/lib/env.ts
 * envValue). Returns null when unconfigured so callers can fail closed.
 */
export function resolveStorageConfig(env = process.env) {
  const supabaseUrl = cleanSecret(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = cleanSecret(env.SUPABASE_SERVICE_ROLE_KEY);
  const bucket =
    cleanSecret(env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET) ||
    cleanSecret(env.SUPABASE_STORAGE_BUCKET) ||
    "product-media";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey, bucket };
}

/** Build the public CDN URL for a relative storage path (script-side mirror of
 *  src/lib/supabase/storage.ts resolveSupabaseStorageUrl). */
export function publicStorageUrl({ supabaseUrl, bucket }, value) {
  if (!value) return "";
  if (/^(https?:|data:|blob:)/.test(value) || value.startsWith("/")) return value;
  const clean = value.replace(/^\/+/, "");
  const encoded = clean.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${encoded}`;
}

function cleanSecret(value) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("GET_FROM_")) return null;
  return trimmed;
}

/**
 * Basic SSRF guard for the ingest-from-external-URL path: only allow http(s)
 * to a public host. Blocks loopback/link-local/private ranges and obvious
 * internal names so a hostile feed URL can't be used to reach cloud metadata
 * or the internal network. Not a substitute for a full egress policy (no
 * DNS-rebind protection) — pair with a review of this surface.
 */
export function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL "${rawUrl}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`blocked non-http(s) URL "${rawUrl}"`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateOrLoopbackIp(host)
  ) {
    throw new Error(`blocked non-public host "${host}"`);
  }
  return url;
}

function isPrivateOrLoopbackIp(host) {
  // IPv6 loopback / link-local / unique-local
  if (host === "::1" || host === "::") return true;
  if (/^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  // IPv4 (also inside IPv4-mapped IPv6 like ::ffff:127.0.0.1)
  const m = host.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Pick the first usable Postgres connection string, matching the existing
 *  scripts (DATABASE_URL first, then Vercel Postgres fallbacks). */
export function resolveConnectionString(env = process.env) {
  return [
    env.DATABASE_URL,
    env.POSTGRES_PRISMA_URL,
    env.POSTGRES_URL,
    env.POSTGRES_URL_NON_POOLING,
  ].find((value) => value?.trim());
}

/** Add sslmode=no-verify for remote hosts (matches import-book12). */
export function withSslNoVerify(connectionString) {
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
