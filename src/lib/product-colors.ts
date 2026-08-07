/** Values such as `190x80` describe a size, even when an import put them in a colour field. */
const DIMENSION_LABEL =
  /^\s*\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm)?\s*$/i;

export function isProductColorLabel(value: string | null | undefined) {
  return normalizeProductColorLabel(value) !== null;
}

/** Keep malformed size values out of storefront and operational colour fields. */
export function normalizeProductColorLabel(
  value: string | null | undefined,
) {
  const label = value?.trim();
  return label && !DIMENSION_LABEL.test(label) ? label : null;
}
