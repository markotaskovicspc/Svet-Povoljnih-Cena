import {expect,it} from 'vitest';
import {currentStaffLoyaltyPrices, staffLoyaltyPricesMatch} from '@/lib/checkout/staff-loyalty-pricing';
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

it('derives current staff offers without stacking on action or fixed set prices', () => {
 const lines = [
  {sku:'LOYALTY',qty:2,product:{fullPrice:1000,loyaltyDiscountPct:30}},
  {sku:'ACTION',qty:1,product:{fullPrice:1000,salePrice:800,loyaltyDiscountPct:30}},
  {sku:'SET',qty:1,product:{fullPrice:1000,fixedSetPrice:600,loyaltyDiscountPct:30}},
  {sku:'REGULAR',qty:1,product:{fullPrice:1000,loyaltyDiscountPct:0}},
 ];
 expect(currentStaffLoyaltyPrices([...lines, lines[0]])).toEqual([{sku:'LOYALTY',price:700}]);
 expect(staffLoyaltyPricesMatch(lines,currentStaffLoyaltyPrices(lines))).toBe(true);
 const result=computeOrderPricing({lines: lines.map(line=>({...line,product:{...line.product,loyaltyEligible:true}})),eligibility:{firstPurchase:false,savedCard:false}});
 expect(result.lines.map(line=>line.unitPriceSale)).toEqual([700,800,600,1000]);
 expect(result.firstPurchaseDiscount).toBe(0);
});
