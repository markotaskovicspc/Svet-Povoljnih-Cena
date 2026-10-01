import { effectiveUnitPrice, type PricingLine } from '@/lib/pricing';

export type StaffLoyaltyPrice = { sku: string; price: number };

// Trusted server option, never a checkout form field. Staff can honor the
// current advertised loyalty price without enrolling the buyer in membership.
export function staffLoyaltyPricesMatch(lines: PricingLine[], approved: readonly StaffLoyaltyPrice[]) {
  const seen = new Set<string>();
  return approved.length > 0 && approved.every(({sku, price}) => {
    if (seen.has(sku) || !Number.isFinite(price) || price <= 0) return false;
    seen.add(sku);
    const line = lines.find(item => item.sku === sku);
    if (!line) return false;
    const regular = effectiveUnitPrice({...line.product, loyaltyEligible:false}).effective;
    const offered = effectiveUnitPrice({...line.product, loyaltyEligible:true}).effective;
    return offered < regular && Math.round(offered * 100) === Math.round(price * 100);
  });
}
