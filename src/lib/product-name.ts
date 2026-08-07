/** Builds the customer-facing product name without changing the stored name. */
export function formatProductDisplayName(
  name: string,
  sizeLabel?: string | null,
): string {
  const cleanName = name.trim();
  const cleanSize = sizeLabel?.trim().replace(/\s+/g, " ") ?? "";

  if (!cleanSize) return cleanName;
  if (!cleanName) return cleanSize;

  const normalizedName = cleanName.toLocaleLowerCase("sr-Latn-RS");
  const normalizedSize = cleanSize.toLocaleLowerCase("sr-Latn-RS");
  const existingSuffixes = [
    ` ${normalizedSize}`,
    ` (${normalizedSize})`,
    ` - ${normalizedSize}`,
    ` – ${normalizedSize}`,
    ` — ${normalizedSize}`,
    ` / ${normalizedSize}`,
  ];

  if (
    normalizedName === normalizedSize ||
    existingSuffixes.some((suffix) => normalizedName.endsWith(suffix))
  ) {
    return cleanName;
  }

  return `${cleanName} – ${cleanSize}`;
}
