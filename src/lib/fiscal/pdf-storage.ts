import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_FISCAL_BUCKET = "fiscal-receipts";

function fiscalBucket() {
  return process.env.SUPABASE_FISCAL_BUCKET ?? DEFAULT_FISCAL_BUCKET;
}

/**
 * Persist the provider-issued official fiscal PDF (QR + signature).
 * Returns null when Supabase storage is not configured so issuance
 * never fails on a missing bucket — the receipt itself is already
 * fiscalized at this point.
 *
 * The bucket is private (receipts hold buyer PII and order numbers are
 * sequential/enumerable); consumers fetch bytes via downloadFiscalPdf.
 */
export async function uploadFiscalPdf(args: {
  orderNumber: string;
  receiptNumber: string;
  bytes: Buffer;
}): Promise<{ objectKey: string } | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const objectKey = `${args.orderNumber}/${sanitize(args.receiptNumber)}.pdf`;
  const storage = createAdminClient().storage.from(fiscalBucket());
  const { error } = await storage.upload(objectKey, args.bytes, {
    upsert: true,
    contentType: "application/pdf",
    cacheControl: "3600",
  });
  if (error) throw error;
  return { objectKey };
}

/** Fetch a previously stored official PDF; null if missing/unconfigured. */
export async function downloadFiscalPdf(objectKey: string): Promise<Buffer | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const storage = createAdminClient().storage.from(fiscalBucket());
  const { data, error } = await storage.download(objectKey);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Receipt numbers may contain `/` (badi counters) — keep keys flat per order. */
function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
