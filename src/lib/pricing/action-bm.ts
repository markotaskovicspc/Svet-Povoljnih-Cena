export function actionGrossMarginPct(
  actionRetailPriceRsd: number | null | undefined,
  cogsRsd: number | null | undefined,
) {
  if (
    actionRetailPriceRsd == null ||
    cogsRsd == null ||
    !Number.isFinite(actionRetailPriceRsd) ||
    !Number.isFinite(cogsRsd) ||
    actionRetailPriceRsd <= 0 ||
    cogsRsd < 0
  ) {
    return null;
  }

  const netRetailPrice = actionRetailPriceRsd / 1.2;
  return Number(
    (((netRetailPrice - cogsRsd) / netRetailPrice) * 100).toFixed(2),
  );
}
