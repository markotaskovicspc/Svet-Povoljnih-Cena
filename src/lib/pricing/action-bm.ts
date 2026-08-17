import { grossMarginPct } from "@/lib/pricing/gross-margin";

export function actionGrossMarginPct(
  actionRetailPriceRsd: number | null | undefined,
  cogsRsd: number | null | undefined,
) {
  return grossMarginPct(actionRetailPriceRsd, cogsRsd);
}
