/** Values such as `190x80` describe a size, even when an import put them in a colour field. */
const DIMENSION_LABEL =
  /^\s*\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm)?\s*$/i;

export function isProductColorLabel(value: string | null | undefined) {
  const label = value?.trim();
  return Boolean(label && !DIMENSION_LABEL.test(label));
}
