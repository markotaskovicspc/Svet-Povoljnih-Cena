const RENDERABLE_MEDIA_SCHEMES = /^(https?:|data:|blob:)/;

export type MediaVariant = "thumb" | "card" | "pdp" | "original";

export interface VariantMediaAsset {
  url?: string | null;
  thumbUrl?: string | null;
  cardUrl?: string | null;
  pdpUrl?: string | null;
}

export function isRenderableMediaUrl(value: string | null | undefined) {
  if (!value) return false;
  const url = value.trim();
  if (!url) return false;
  return url.startsWith("/") || RENDERABLE_MEDIA_SCHEMES.test(url);
}

export function isRenderableImageUrl(value: string | null | undefined) {
  return isRenderableMediaUrl(value);
}

export function getMediaVariantUrl(
  asset: VariantMediaAsset | null | undefined,
  variant: MediaVariant,
) {
  if (!asset) return "";
  if (variant === "thumb") {
    return asset.thumbUrl || asset.cardUrl || asset.pdpUrl || asset.url || "";
  }
  if (variant === "card") {
    return asset.cardUrl || asset.thumbUrl || asset.pdpUrl || asset.url || "";
  }
  if (variant === "pdp") {
    return asset.pdpUrl || asset.cardUrl || asset.url || asset.thumbUrl || "";
  }
  return asset.url || asset.pdpUrl || asset.cardUrl || asset.thumbUrl || "";
}
