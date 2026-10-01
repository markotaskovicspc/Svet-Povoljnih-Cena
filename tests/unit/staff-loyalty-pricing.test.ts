import {expect,it} from 'vitest';
import {staffLoyaltyPricesMatch} from '@/lib/checkout/staff-loyalty-pricing';
import {computeOrderPricing} from '@/lib/pricing';

it('validates exact current offers per SKU, not arbitrary discounts or enrollment',()=>{
 const lines=[{sku:'TABLE',qty:1,product:{fullPrice:3999,loyaltyPrice:2999,loyaltyEligible:true}},
  {sku:'MOP',qty:1,product:{fullPrice:699,loyaltyPrice:499,loyaltyEligible:false}}];
 expect(staffLoyaltyPricesMatch(lines,[{sku:'TABLE',price:2999}])).toBe(true);
 for(const prices of [[],[{sku:'MISSING',price:2999}],[{sku:'TABLE',price:1}],
  [{sku:'TABLE',price:2999},{sku:'TABLE',price:2999}],[{sku:'TABLE',price:3999}]]) {
  expect(staffLoyaltyPricesMatch(lines,prices)).toBe(false);
 }
 const result=computeOrderPricing({lines,eligibility:{firstPurchase:false,savedCard:false}});
 expect(result.lines.map(p=>p.unitPriceSale)).toEqual([2999,699]);
 expect(result.firstPurchaseDiscount).toBe(0);
});
