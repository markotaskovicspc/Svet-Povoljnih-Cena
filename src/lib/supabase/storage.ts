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

export function getManagedProductMediaStorageKey(
  value: string | null | undefined,
) {
  if (!value || /^(data:|blob:)/.test(value) || value.startsWith("/")) {
    return null;
  }
  if (!/^https?:\/\//.test(value)) {
    return value.replace(/^\/+/, "");
  }

  try {
    const mediaUrl = new URL(value);
    const baseUrl = publicSupabaseUrl();
    if (!baseUrl || mediaUrl.origin !== new URL(baseUrl).origin) {
      return null;
    }
    const bucket = getProductMediaBucket();
    const prefixes = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
    ];
    const prefix = prefixes.find((candidate) =>
      mediaUrl.pathname.startsWith(candidate),
    );
    if (!prefix) return null;
    return mediaUrl.pathname
      .slice(prefix.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
  } catch {
    return null;
  }
}

export function getManagedProductMediaStorageKeys(media: {
  url?: string | null;
  thumbUrl?: string | null;
  cardUrl?: string | null;
  pdpUrl?: string | null;
}) {
  return Array.from(
    new Set(
      [media.url, media.thumbUrl, media.cardUrl, media.pdpUrl]
        .map(getManagedProductMediaStorageKey)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function resolveSupabaseStorageMedia<T extends {
  url: string | null;
  thumbUrl?: string | null;
  cardUrl?: string | null;
  pdpUrl?: string | null;
}>(media: T) {
  return {
    ...media,
    url: resolveSupabaseStorageUrl(media.url),
    thumbUrl: resolveSupabaseStorageUrl(media.thumbUrl),
    cardUrl: resolveSupabaseStorageUrl(media.cardUrl),
    pdpUrl: resolveSupabaseStorageUrl(media.pdpUrl),
  };
}
