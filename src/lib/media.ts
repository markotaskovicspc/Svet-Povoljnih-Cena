const RENDERABLE_MEDIA_SCHEMES = /^(https?:|data:|blob:)/;

export function isRenderableMediaUrl(value: string | null | undefined) {
  if (!value) return false;
  const url = value.trim();
  if (!url) return false;
  return url.startsWith("/") || RENDERABLE_MEDIA_SCHEMES.test(url);
}

export function isRenderableImageUrl(value: string | null | undefined) {
  return isRenderableMediaUrl(value);
}
