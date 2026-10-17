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

it('keeps calendar quantity available when stock history is missing and explains why valuation is unknown', () => {
 const missing = calculateProductPerformance({...input, baseline: null, movements: []}, period, now);
 expect(missing).toMatchObject({netQuantityPerDay: 2.5, historyStatus: 'incomplete-stock', averageStockValue: null});
 expect(calculateProductPerformance({...input, latestBalance: 6}, period, now).historyStatus).toBe('unreconciled');
 expect(calculateProductPerformance({...input, costEvents: []}, period, now).historyStatus).toBe('incomplete-cost');
});
it('reports a documented subtotal without mixing unknown SKUs into its turnover numerator', () => {
 const known = calculateProductPerformance(input, period, now);
 const missing = {...known, id: 'b', sku: 'B', cogs: 9000, averageStockValue: null};
 const summary = summarizeProductPerformance([known, missing]);
 expect(summary).toMatchObject({averageStockValue: null, estimatedKoz: null, knownStockValue: 750, documentedCount: 1, documentedCogs: 500, documentedStockValue: 750});
 expect(summary.documentedKoz).toBeCloseTo(2 / 3);
 expect(summarizeProductPerformance([missing]).documentedKoz).toBeNull();
});

it('estimates missed sales from confirmed stockout dates and counts receipt and sellout dates', () => {
 const p = resolveReportPeriod({range:'custom',from:'2026-10-01',to:'2026-10-06'});
 const row = calculateProductPerformance({...input, baseline:0, stock:0, latestBalance:0,
  movements:[{at:'2026-10-02T10:00:00Z',qty:10,balance:10},{at:'2026-10-04T10:00:00Z',qty:-10,balance:0}],
  sales:[{day:'2026-10-04',qty:10,revenue:3000,cogs:1000}]},p,new Date('2026-10-07T10:00:00Z'));
 expect(row).toMatchObject({periodDays:6,availableDays:3,outOfStockDays:3,unknownStockDays:0,dailyRevenue:1000,estimatedLostRevenue:3000});
 expect(row.dailyQty).toBeCloseTo(10/3);
 expect(row.netQuantityPerDay).toBeCloseTo(10/6);
 expect(row.estimatedLostQuantity).toBeCloseTo(10);
});
it('counts the first receipt date without turning dates before it into stockout days', () => {
 const p=resolveReportPeriod({range:'custom',from:'2026-10-01',to:'2026-10-04'});
 const row=calculateProductPerformance({...input,baseline:null,stock:20,latestBalance:20,
 movements:[{at:'2026-10-02T08:00:00Z',qty:24,balance:24},{at:'2026-10-03T08:00:00Z',qty:-4,balance:20}],
 sales:[{day:'2026-10-03',qty:4,revenue:1000,cogs:400}]},p,now);
 expect(row).toMatchObject({availableDays:3,outOfStockDays:0,unknownStockDays:1,estimatedLostQuantity:0,estimatedLostRevenue:0,completeHistory:false,averageStockValue:null});
 expect(row.dailyQty).toBeCloseTo(4/3);
});
it('keeps a partly unknown date out of stockout estimates when its only known stock is zero', () => {
 const row=calculateProductPerformance({...input,baseline:null,stock:0,latestBalance:0,
 movements:[{at:'2026-10-01T08:00:00Z',qty:-1,balance:0}],sales:[]},period,now);
 expect(row).toMatchObject({availableDays:0,outOfStockDays:1,unknownStockDays:1,estimatedLostQuantity:null,estimatedLostRevenue:null});
});
it('excludes replenishment gaps from available days and does not estimate from corrupt history', () => {
 const p=resolveReportPeriod({range:'custom',from:'2026-10-01',to:'2026-10-06'});
 const data={...input,baseline:2,stock:2,latestBalance:2,
 movements:[{at:'2026-10-01T10:00:00Z',qty:-2,balance:0},{at:'2026-10-04T10:00:00Z',qty:4,balance:4},{at:'2026-10-05T10:00:00Z',qty:-2,balance:2}],
 sales:[{day:'2026-10-01',qty:2,revenue:200,cogs:100},{day:'2026-10-05',qty:2,revenue:200,cogs:100}]};
 expect(calculateProductPerformance(data,p,new Date('2026-10-07T10:00:00Z'))).toMatchObject({availableDays:4,outOfStockDays:2,unknownStockDays:0,dailyQty:1,estimatedLostQuantity:2});
 expect(calculateProductPerformance({...data,stockHistoryConsistent:false},p,now)).toMatchObject({availableDays:null,outOfStockDays:null,unknownStockDays:5,estimatedLostQuantity:null,estimatedLostRevenue:null});
});
