const DEFAULT_PRODUCT_MEDIA_BUCKET = "product-media";

function publicSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

export function getProductMediaBucket() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET ??
    process.env.SUPABASE_STORAGE_BUCKET ??
    DEFAULT_PRODUCT_MEDIA_BUCKET
  );
}

export function resolveSupabaseStorageUrl(value: string | null | undefined) {
  if (!value) return "";
  if (/^(https?:|data:|blob:)/.test(value) || value.startsWith("/")) {
    return value;
  }

  const baseUrl = publicSupabaseUrl();
  if (!baseUrl) return value;

  const path = value.replace(/^\/+/, "");
  const bucket = getProductMediaBucket();
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${encodedPath}`;
}
