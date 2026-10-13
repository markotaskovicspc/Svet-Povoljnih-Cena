import { expect, it } from 'vitest';
import { calculateProductPerformance, type PerformanceInput } from '@/lib/admin/product-performance';
import { historicalCostAt, reconstructReceiptCosts } from '@/lib/admin/historical-inventory-cost';
import { resolveReportPeriod } from '@/lib/admin/report-period';
const period = resolveReportPeriod({ range: 'custom', from: '2026-10-01', to: '2026-10-02' });
const now = new Date('2026-10-03T12:00:00Z');
const input: PerformanceInput = {
 id:'p',sku:'P',name:'P',stock:10,baseline:10,latestBalance:10,movements:[],
 costEvents:[],purchasePrices:[
  {from:'2026-09-30T22:00:00Z',to:'2026-10-01T22:00:00Z',unitCost:100},
  {from:'2026-10-01T22:00:00Z',to:null,unitCost:200},
 ],sales:[{day:'2026-10-02',at:'2026-10-02T08:00:00Z',qty:2,revenue:600,cogs:null}],
};
it('weights historical price changes and recovers legacy sale COGS at the sale date',()=>{
 const row=calculateProductPerformance(input,period,now);
 expect(row).toMatchObject({averageStockValue:1500,cogs:400,estimatedSalesCogs:true,valuationBasis:'purchase-prices',completeCostHistory:true});
 expect(row.estimatedKoz).toBeCloseTo(400/1500);
});
it('weights simultaneous stock and price changes, not the final price times average quantity',()=>{
 const row=calculateProductPerformance({...input,stock:5,latestBalance:5,movements:[{at:'2026-10-01T22:00:00Z',qty:-5,balance:5}]},period,now);
 expect(row.averageStockQty).toBe(7.5); expect(row.averageStockValue).toBe(1000);
});
it('keeps gaps and expired prices unknown, but needs no cost when stock is zero',()=>{
 expect(calculateProductPerformance({...input,purchasePrices:input.purchasePrices.slice(0,1)},period,now).averageStockValue).toBeNull();
 expect(calculateProductPerformance({...input,purchasePrices:[],stock:0,baseline:0,latestBalance:0},period,now).averageStockValue).toBe(0);
});
it('does not use a future fiscal snapshot or convert a foreign quote with an invented rate',()=>{
 const costs={purchasePrices:[{...input.purchasePrices[0],unitCost:null}],costEvents:[{at:'2026-10-03T00:00:00Z',unitCost:999,source:'fiscal' as const}]};
 expect(historicalCostAt(costs,Date.parse('2026-10-01T12:00:00Z'))).toBeNull();
});
it('values existing stock at recorded COGS, then reconstructs a legacy landed-cost receipt',()=>{
 const costs=reconstructReceiptCosts({purchasePrices:[],costEvents:[
  {at:'2026-09-01T00:00:00Z',unitCost:100,source:'fiscal'},
  {at:'2026-10-01T22:00:00Z',unitCost:null,source:'receipt',beforeStock:10,incomingQty:10,incomingCost:3000},
 ]});
 expect(historicalCostAt(costs,Date.parse('2026-10-02T12:00:00Z'))).toEqual({unitCost:200,source:'booking'});
});
it('does not reuse old COGS after an unvalued receipt',()=>{
 const costs=reconstructReceiptCosts({purchasePrices:[],costEvents:[
  {at:'2026-09-01T00:00:00Z',unitCost:100,source:'fiscal'},
  {at:'2026-10-01T22:00:00Z',unitCost:null,source:'receipt',beforeStock:10,incomingQty:10,incomingCost:null},
 ]});
 expect(historicalCostAt(costs,Date.parse('2026-10-02T12:00:00Z'))).toBeNull();
});
it('values a legacy refund at the original sale date rather than the refund date',()=>{
 const row=calculateProductPerformance({...input,sales:[{day:'2026-10-02',at:'2026-10-01T08:00:00Z',qty:-2,revenue:-600,cogs:null}]},period,now);
 expect(row.cogs).toBe(-200);
});
it('uses fiscal snapshots before quotes and keeps actual fiscal sales COGS unchanged',()=>{
 const row=calculateProductPerformance({...input,costEvents:[{at:'2026-09-01T00:00:00Z',unitCost:120,source:'fiscal'}],sales:[{day:'2026-10-02',qty:2,revenue:600,cogs:240}]},period,now);
 expect(row).toMatchObject({averageStockValue:1200,cogs:240,estimatedValuation:false,estimatedSalesCogs:false,valuationBasis:'fiscal'});
});
