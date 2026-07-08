import "server-only";

import { db } from "@/lib/db";
// The variant sizes, sharp generation, Supabase upload and path helpers live in
// one shared engine so the cron route and the standalone worker script
// (scripts/backfill-media-variants.mjs) can never drift apart.
import {
  assertPublicHttpUrl,
  generateAndUploadVariants,
  publicStorageUrl,
  resolveStorageConfig,
} from "../../../scripts/lib/media-variants.mjs";

const MAX_SOURCE_BYTES =
  (Number.parseInt(process.env.MAX_SOURCE_MB || "", 10) || 40) * 1024 * 1024;

export type VariantBackfillResult = {
  ok: boolean;
  reason?: string;
  processed: number;
  updated: number;
  failed: number;
  remaining: number;
};

/**
 * Process a small batch of ProductMedia image rows that are missing variants:
 * fetch the source, generate thumb/card/pdp WebP, upload to Supabase, and write
 * the relative paths back. Fails closed (ok:false) when storage is not
 * configured. Idempotent — only rows still missing a variant are picked up.
 */
export async function runVariantBackfill(limit = 20): Promise<VariantBackfillResult> {
  const storage = resolveStorageConfig();
  if (!storage) {
    return { ok: false, reason: "storage-unconfigured", processed: 0, updated: 0, failed: 0, remaining: 0 };
  }

  const rows = await db.productMedia.findMany({
    where: {
      kind: "IMAGE",
      OR: [{ thumbUrl: null }, { cardUrl: null }, { pdpUrl: null }],
    },
    select: { id: true, productId: true, url: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const source = await loadSource(storage, row.url);
      const storageBase = `products/${row.productId}/${row.id}`;
      const variantUrls = await generateAndUploadVariants(storage, source, storageBase);
      await db.productMedia.update({ where: { id: row.id }, data: variantUrls });
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  const remaining = await db.productMedia.count({
    where: {
      kind: "IMAGE",
      OR: [{ thumbUrl: null }, { cardUrl: null }, { pdpUrl: null }],
    },
  });

  return { ok: true, processed: rows.length, updated, failed, remaining };
}

async function loadSource(
  storage: { supabaseUrl: string; bucket: string },
  url: string | null,
): Promise<Buffer> {
  if (!url) throw new Error("empty url");
  const fetchUrl = /^https?:\/\//i.test(url) ? url : publicStorageUrl(storage, url);
  if (!/^https?:\/\//i.test(fetchUrl)) {
    throw new Error(`cannot resolve a fetchable URL from "${url}"`);
  }
  assertPublicHttpUrl(fetchUrl);
  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`download ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`unexpected content-type "${contentType}"`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("empty download");
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("source too large");
  return buffer;
}
