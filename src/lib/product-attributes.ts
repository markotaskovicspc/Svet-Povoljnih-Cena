const PRODUCT_ATTRIBUTE_LOCALE = "sr-Latn-RS";

export function formatProductAttributes(
  values: Array<string | null | undefined>,
): string[] {
  return values.flatMap((value) => {
    const normalized = value?.trim();

    return normalized
      ? [normalized.toLocaleUpperCase(PRODUCT_ATTRIBUTE_LOCALE)]
      : [];
  });
}
