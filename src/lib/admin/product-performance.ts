import { type ReportPeriod } from './report-period';
import { historicalCostAt, historicalCostBoundaries, reconstructReceiptCosts, type HistoricalCosts } from './historical-inventory-cost';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayAt = (time: number) => { const parts = dayFormatter.formatToParts(new Date(time)); return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value).join('-'); };
export type StockPoint = { at: string; qty: number; balance: number | null };
export type ProductSale = { day: string; at?: string | null; qty: number; revenue: number; cogs: number | null };
export type PerformanceInput = HistoricalCosts & { id: string; sku: string; name: string; stock: number; baseline: number | null; latestBalance: number | null; stockHistoryConsistent?: boolean | null; movements: StockPoint[]; sales: ProductSale[] };
export type ProductPerformance = ReturnType<typeof calculateProductPerformance>;

export function calculateProductPerformance(product: PerformanceInput, period: ReportPeriod, now: Date) {
  const historicalCosts = reconstructReceiptCosts(product);
  const start = period.start.getTime(), end = Math.min(period.endExclusive.getTime(), now.getTime());
  let at = start, balance = product.baseline, weightedQty = 0, knownMs = 0;
  let weightedValue = 0, valuedMs = 0;
  const valuationSources = new Set<string>();
  let consistent = product.stockHistoryConsistent !== false && product.latestBalance !== null && product.latestBalance === product.stock;
  const available = new Set<string>(), unknown = new Set<string>(), observed = new Set<string>();
  const visitSegment = (until: number) => {
    if (until <= at) return;
    if (balance !== null) {
      knownMs += until - at; weightedQty += Math.max(0, balance) * (until - at);
      const boundaries = [at, ...historicalCostBoundaries(historicalCosts, at, until), until];
      for (let index = 0; index < boundaries.length - 1; index++) {
        const duration = boundaries[index + 1] - boundaries[index];
        const cost = historicalCostAt(historicalCosts, boundaries[index]);
        if (balance <= 0 || cost) {
          valuedMs += duration;
          weightedValue += Math.max(0, balance) * (cost?.unitCost ?? 0) * duration;
          if (balance > 0 && cost) valuationSources.add(cost.source);
        }
      }
    }
    // Calendar labels advance independently of 23/25-hour DST durations.
    const first = dayAt(at), last = dayAt(until - 1);
    for (let cursor = Date.parse(first + 'T00:00:00Z'); ; cursor += 86400_000) {
      const day = new Date(cursor).toISOString().slice(0,10);
      if (day > last) break;
      if (balance === null) unknown.add(day);
      else { observed.add(day); if (balance > 0) available.add(day); }
    }
    at = until;
  };
  for (const movement of product.movements) {
    const time = Date.parse(movement.at);
    if (time < start || time >= end) continue;
    visitSegment(time);
    if (balance !== null && movement.balance !== null && balance + movement.qty !== movement.balance) consistent = false;
    balance = movement.balance ?? (balance === null ? null : balance + movement.qty);
  }
  visitSegment(end);
  // A receipt day counts once stock becomes positive, even if its earlier
  // hours are unknown. Only fully observed dates without positive stock
  // are confirmed stockout days; unknown dates never become lost sales.
  if (!consistent) available.clear();
  let estimatedSalesCogs = false;
  const sales = product.sales.map(sale => {
    if (sale.cogs !== null || !sale.at) return sale;
    const cost = historicalCostAt(historicalCosts, Date.parse(sale.at));
    if (!cost) return sale;
    estimatedSalesCogs = true;
    return { ...sale, cogs: sale.qty * cost.unitCost };
  });
  const availableSales = sales.filter(sale => available.has(sale.day));
  const quantity = product.sales.reduce((sum, sale) => sum + sale.qty, 0);
  const revenue = product.sales.reduce((sum, sale) => sum + sale.revenue, 0);
  const firstDay = Date.parse(dayAt(start) + 'T00:00:00Z');
  const lastDay = Date.parse(dayAt(end - 1) + 'T00:00:00Z');
  const periodDays = end > start ? Math.round((lastDay - firstDay) / 86400_000) + 1 : 0;
  const netRevenuePerDay = periodDays > 0 ? revenue / periodDays : null;
  const netQuantityPerDay = periodDays > 0 ? quantity / periodDays : null;
  const averageRetailPrice = quantity > 0 && revenue >= 0 ? revenue / quantity : null;
  const cogs = sales.some(sale => sale.cogs === null) ? null : sales.reduce((sum, sale) => sum + (sale.cogs ?? 0), 0);
  const availableDays = consistent && knownMs > 0 ? available.size : null;
  const outOfStockDays = consistent && knownMs > 0
    ? [...observed].filter(day => !available.has(day) && !unknown.has(day)).length : null;
  const unknownStockDays = consistent ? periodDays - available.size - (outOfStockDays ?? 0) : periodDays;
  const dailyQty = availableDays ? availableSales.reduce((sum, sale) => sum + sale.qty, 0) / availableDays : null;
  const dailyRevenue = availableDays ? availableSales.reduce((sum, sale) => sum + sale.revenue, 0) / availableDays : null;
  const estimatedLostQuantity = dailyQty !== null && outOfStockDays !== null ? Math.max(0, dailyQty) * outOfStockDays : null;
  const estimatedLostRevenue = dailyRevenue !== null && outOfStockDays !== null ? Math.max(0, dailyRevenue) * outOfStockDays : null;
  const completeHistory = consistent && end > start && knownMs === end - start;
  const averageStockQty = completeHistory ? weightedQty / (end - start) : null;
  const completeCostHistory = completeHistory && valuedMs === end - start;
  const averageStockValue = completeCostHistory ? weightedValue / (end - start) : null;
  const valuationBasis = !completeCostHistory ? 'missing' : valuationSources.size === 0 ? 'zero-stock' : valuationSources.size > 1 ? 'mixed'
    : valuationSources.has('purchase-price') ? 'purchase-prices' : valuationSources.has('booking') ? 'booking' : 'fiscal';
  const estimatedValuation = valuationSources.has('purchase-price') || valuationSources.has('booking');
  return { id: product.id, sku: product.sku, name: product.name, stock: product.stock, quantity, revenue, cogs,
    periodDays, outOfStockDays, unknownStockDays, estimatedLostQuantity, estimatedLostRevenue, netRevenuePerDay, netQuantityPerDay, averageRetailPrice, availableDays, dailyQty, dailyRevenue, averageStockQty, averageStockValue, completeHistory, completeCostHistory,
    valuationBasis, estimatedValuation, estimatedSalesCogs,
    historyStatus: product.latestBalance === null ? 'incomplete-stock' as const : !consistent ? 'unreconciled' as const : !completeHistory ? 'incomplete-stock' as const : !completeCostHistory ? 'incomplete-cost' as const : 'complete' as const,
    estimatedKoz: cogs !== null && averageStockValue !== null && averageStockValue > 0 ? cogs / averageStockValue : null,
    coverageDays: dailyQty !== null && dailyQty > 0 ? Math.max(0, product.stock) / dailyQty : null };
}

export function summarizeProductPerformance(rows: ProductPerformance[]) {
  const sum = (key: 'stock'|'quantity'|'revenue') => rows.reduce((total, row) => total + row[key], 0);
  const cogs = rows.some(row => row.cogs === null) ? null : rows.reduce((total, row) => total + (row.cogs ?? 0), 0);
  const averageStockValue = rows.some(row => row.averageStockValue === null) ? null : rows.reduce((total, row) => total + (row.averageStockValue ?? 0), 0);
  // A documented subset can be shown even when one SKU lacks historical data.
  // Its numerator and denominator must cover exactly the same articles.
  const documented = rows.filter(row => row.cogs !== null && row.averageStockValue !== null);
  const documentedCogs = documented.reduce((total, row) => total + (row.cogs ?? 0), 0);
  const documentedStockValue = documented.reduce((total, row) => total + (row.averageStockValue ?? 0), 0);
  const valued = rows.filter(row => row.averageStockValue !== null);
  const knownStockValue = valued.length ? valued.reduce((total, row) => total + (row.averageStockValue ?? 0), 0) : null;
  return { documentedCount: documented.length, documentedCogs, documentedStockValue, knownStockValue,
    documentedKoz: documentedStockValue > 0 ? documentedCogs / documentedStockValue : null,
    count: rows.length, stock: sum('stock'), quantity: sum('quantity'), revenue: sum('revenue'), cogs, averageStockValue,
    completeCount: rows.filter(row => row.completeHistory).length,
    costHistoryCount: rows.filter(row => row.completeCostHistory).length,
    estimatedCount: rows.filter(row => row.completeCostHistory && row.estimatedValuation).length,
    estimatedCogsCount: rows.filter(row => row.estimatedSalesCogs).length,
    estimatedKoz: cogs !== null && averageStockValue !== null && averageStockValue > 0 ? cogs / averageStockValue : null };
}
export const PERFORMANCE_SORTS = ['sku','name','stock','quantity','revenue','cogs','availableDays','outOfStockDays','unknownStockDays','estimatedLostQuantity','estimatedLostRevenue','dailyQty','dailyRevenue','netRevenuePerDay','netQuantityPerDay','averageRetailPrice','averageStockValue','estimatedKoz','coverageDays'] as const;
export type PerformanceSort = typeof PERFORMANCE_SORTS[number];
export function sortProductPerformance(rows: ProductPerformance[], sort: PerformanceSort, direction: 'asc'|'desc') {
  return [...rows].sort((a,b) => {
    const av = a[sort], bv = b[sort];
    if (av === null && bv === null) return a.sku.localeCompare(b.sku);
    if (av === null) return 1; if (bv === null) return -1;
    const compare = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv,'sr-Latn') : Number(av) - Number(bv);
    return (direction === 'asc' ? compare : -compare) || a.sku.localeCompare(b.sku);
  });
}
