export const DEFAULT_RETAIL_VAT_RATE = 0.2;

/**
 * Bruto marža se u svim MP tokovima računa iz prodajne cene bez PDV-a i
 * jediničnog COGS-a. Ulazna cena je maloprodajna cena sa PDV-om.
 */
export function grossMarginPct(
  grossRetailPriceRsd: number | null | undefined,
  cogsRsd: number | null | undefined,
  vatRate = DEFAULT_RETAIL_VAT_RATE,
) {
  if (
    grossRetailPriceRsd == null ||
    cogsRsd == null ||
    !Number.isFinite(grossRetailPriceRsd) ||
    !Number.isFinite(cogsRsd) ||
    !Number.isFinite(vatRate) ||
    grossRetailPriceRsd <= 0 ||
    cogsRsd < 0 ||
    vatRate < 0
  ) {
    return null;
  }

  const netRetailPrice = grossRetailPriceRsd / (1 + vatRate);
  return Number(
    (((netRetailPrice - cogsRsd) / netRetailPrice) * 100).toFixed(2),
  );
}
