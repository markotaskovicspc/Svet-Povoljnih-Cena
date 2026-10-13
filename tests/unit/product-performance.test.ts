import { expect, it } from 'vitest';
import { calculateProductPerformance, summarizeProductPerformance, sortProductPerformance, type PerformanceInput } from '@/lib/admin/product-performance';
import { resolveReportPeriod } from '@/lib/admin/report-period';
const period=resolveReportPeriod({range:'custom',from:'2026-10-01',to:'2026-10-02'});
const now=new Date('2026-10-05T10:00:00Z');
const input:PerformanceInput={id:'a',sku:'A',name:'Artikal',stock:5,purchasePrices:[],costEvents:[{at:"2026-09-01T00:00:00Z",unitCost:100,source:"fiscal"}],baseline:10,latestBalance:5,
 movements:[{at:'2026-10-01T22:00:00Z',qty:-5,balance:5}],sales:[{day:'2026-10-02',qty:5,revenue:1000,cogs:500}]};
it('uses available calendar days and weighted average stock, not current stock, for turnover',()=>{
 const row=calculateProductPerformance(input,period,now);
 expect(row).toMatchObject({availableDays:2,dailyQty:2.5,dailyRevenue:500,averageStockQty:7.5,averageStockValue:750,cogs:500,coverageDays:2,completeHistory:true});
 expect(row.estimatedKoz).toBeCloseTo(2/3);
});
it('excludes out-of-stock days from averages and does not invent history before first observation',()=>{
 const row=calculateProductPerformance({...input,baseline:null,stock:5,latestBalance:5,movements:[{at:'2026-10-01T22:00:00Z',qty:5,balance:5}]},period,now);
 expect(row).toMatchObject({availableDays:1,dailyQty:5,averageStockValue:null,estimatedKoz:null,completeHistory:false});
 const empty=calculateProductPerformance({...input,stock:0,latestBalance:0,baseline:0,movements:[],sales:[]},period,now);
 expect(empty).toMatchObject({availableDays:0,dailyQty:null,coverageDays:null,estimatedKoz:null,averageStockValue:0});
});
it('leaves missing costs and unlogged stock changes unknown',()=>{
 expect(calculateProductPerformance({...input,latestBalance:6},period,now)).toMatchObject({availableDays:null,averageStockValue:null,estimatedKoz:null});
 expect(calculateProductPerformance({...input,sales:[{day:'2026-10-02',qty:5,revenue:1000,cogs:null}]},period,now).cogs).toBeNull();
});
it('sums numerator and denominator for assortment turnover rather than averaging SKU ratios',()=>{
 const first=calculateProductPerformance(input,period,now),second={...first,id:'b',sku:'B',cogs:1000,averageStockValue:100,estimatedKoz:10};
 expect(summarizeProductPerformance([first,second]).estimatedKoz).toBeCloseTo(1500/850);
 expect(summarizeProductPerformance([first,{...second,averageStockValue:null}]).estimatedKoz).toBeNull();
});
it('sorts the full selection in both directions and places unknowns last',()=>{
 const first=calculateProductPerformance(input,period,now),second={...first,sku:'B',revenue:1},unknown={...first,sku:'C',revenue:999,dailyQty:null};
 expect(sortProductPerformance([first,second],'revenue','asc').map(r=>r.sku)).toEqual(['B','A']);
 expect(sortProductPerformance([unknown,first],'dailyQty','desc').map(r=>r.sku)).toEqual(['A','C']);
});
it.each([['2026-03-29',23],['2026-10-25',25]])('handles Serbia DST day %s without a 24-hour divisor',(day,hours)=>{
 const p=resolveReportPeriod({range:'custom',from:day,to:day});
 expect(p.endExclusive.getTime()-p.start.getTime()).toBe(hours*3600_000);
 const row=calculateProductPerformance({...input,stock:10,latestBalance:10,movements:[],sales:[]},p,new Date(p.endExclusive.getTime()+1000));
 expect(row.availableDays).toBe(1);expect(row.averageStockQty).toBe(10);
});

it('separates calendar-day revenue from in-stock days and weights MPC by units',()=>{
 const row=calculateProductPerformance({...input,baseline:null,movements:[{at:'2026-10-01T22:00:00Z',qty:5,balance:5}],sales:[{day:'2026-10-02',qty:2,revenue:600,cogs:200},{day:'2026-10-02',qty:3,revenue:300,cogs:300},{day:'2026-10-02',qty:-1,revenue:-100,cogs:-100}]},period,now);
 expect(row).toMatchObject({periodDays:2,dailyRevenue:800,netRevenuePerDay:400,averageRetailPrice:200});
});
it('uses elapsed calendar dates for the current period and leaves no-sale MPC unknown',()=>{
 const row=calculateProductPerformance({...input,sales:[]},period,new Date('2026-10-01T10:00:00Z'));
 expect(row).toMatchObject({periodDays:1,netRevenuePerDay:0,averageRetailPrice:null});
 const refunded=calculateProductPerformance({...input,sales:[{day:'2026-10-02',qty:-1,revenue:-200,cogs:-100}]},period,now);
 expect(refunded).toMatchObject({netRevenuePerDay:-100,averageRetailPrice:null});
 expect(sortProductPerformance([row,{...row,sku:'B',averageRetailPrice:200}],'averageRetailPrice','desc').map(r=>r.sku)).toEqual(['B','A']);
});
