export function actionSalePriceError(
  salePrice: number,
  regularPrice: number,
): string | null {
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return "Akcijska MP cena mora biti veća od nule.";
  }
  if (!Number.isFinite(regularPrice) || regularPrice <= 0) {
    return "Važeća MP cena artikla nije ispravna.";
  }
  if (salePrice >= regularPrice) {
    return `Akcijska MP cena mora biti manja od važeće MP cene (${formatRsd(regularPrice)}).`;
  }
  return null;
}

function formatRsd(value: number) {
  return new Intl.NumberFormat("sr-Latn-RS", {
    style: "currency",
    currency: "RSD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
