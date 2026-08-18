export const RABALUX_BINARY_UPLOAD_REVISION = "binary-v2";
export const RABALUX_MEDIA_JOB_PREFIX =
  `rabalux-${RABALUX_BINARY_UPLOAD_REVISION}-asset:`;

export function directStorageOrigin(supabaseUrl: string) {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    url.hostname = `${url.hostname.slice(0, -".supabase.co".length)}.storage.supabase.co`;
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

/**
 * Give Supabase Storage an isolated ArrayBuffer instead of a Node Buffer.
 *
 * Buffers are Uint8Array subclasses, but some server-side fetch boundaries can
 * coerce them through UTF-8. That silently replaces non-text bytes with EF BF BD
 * and leaves an object that returns HTTP 200 while browsers cannot decode it.
 */
export function toRabaluxMediaUploadBody(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

export function rabaluxMediaJobIdempotencyKey(
  assetId: string,
  assetType: "MEDIA" | "ATTACHMENT",
) {
  return `${RABALUX_MEDIA_JOB_PREFIX}${assetType}:${assetId}`;
}
