import { type ReportPeriod } from './report-period';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayAt = (time: number) => { const parts = dayFormatter.formatToParts(new Date(time)); return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value).join('-'); };
export type StockPoint = { at: string; qty: number; balance: number | null };
export type ProductSale = { day: string; qty: number; revenue: number; cogs: number | null };
export type PerformanceInput = { id: string; sku: string; name: string; stock: number; unitCogs: number | null; baseline: number | null; latestBalance: number | null; movements: StockPoint[]; sales: ProductSale[] };
export type ProductPerformance = ReturnType<typeof calculateProductPerformance>;

export function calculateProductPerformance(product: PerformanceInput, period: ReportPeriod, now: Date) {
  const start = period.start.getTime(), end = Math.min(period.endExclusive.getTime(), now.getTime());
  let at = start, balance = product.baseline, weightedQty = 0, knownMs = 0;
  let consistent = product.latestBalance !== null && product.latestBalance === product.stock;
  const available = new Set<string>(), unknown = new Set<string>();
  const visitSegment = (until: number) => {
    if (until <= at) return;
    if (balance !== null) { knownMs += until - at; weightedQty += Math.max(0, balance) * (until - at); }
    // Calendar labels advance independently of 23/25-hour DST durations.
    const first = dayAt(at), last = dayAt(until - 1);
    for (let cursor = Date.parse(first + 'T00:00:00Z'); ; cursor += 86400_000) {
      const day = new Date(cursor).toISOString().slice(0,10);
      if (day > last) break;
      if (balance === null) unknown.add(day); else if (balance > 0) available.add(day);
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
  for (const day of unknown) available.delete(day);
  if (!consistent) available.clear();
  const availableSales = product.sales.filter(sale => available.has(sale.day));
  const quantity = product.sales.reduce((sum, sale) => sum + sale.qty, 0);
  const revenue = product.sales.reduce((sum, sale) => sum + sale.revenue, 0);
  const cogs = product.sales.some(sale => sale.cogs === null) ? null : product.sales.reduce((sum, sale) => sum + (sale.cogs ?? 0), 0);
  const availableDays = consistent && knownMs > 0 ? available.size : null;
  const dailyQty = availableDays ? availableSales.reduce((sum, sale) => sum + sale.qty, 0) / availableDays : null;
  const dailyRevenue = availableDays ? availableSales.reduce((sum, sale) => sum + sale.revenue, 0) / availableDays : null;
  const completeHistory = consistent && end > start && knownMs === end - start;
  const averageStockQty = completeHistory ? weightedQty / (end - start) : null;
  const averageStockValue = averageStockQty === 0 ? 0 : averageStockQty !== null && product.unitCogs !== null ? averageStockQty * product.unitCogs : null;
  return { id: product.id, sku: product.sku, name: product.name, stock: product.stock, quantity, revenue, cogs,
    availableDays, dailyQty, dailyRevenue, averageStockQty, averageStockValue, completeHistory,
    estimatedKoz: cogs !== null && averageStockValue !== null && averageStockValue > 0 ? cogs / averageStockValue : null,
    coverageDays: dailyQty !== null && dailyQty > 0 ? Math.max(0, product.stock) / dailyQty : null };
}

export function summarizeProductPerformance(rows: ProductPerformance[]) {
  const sum = (key: 'stock'|'quantity'|'revenue') => rows.reduce((total, row) => total + row[key], 0);
  const cogs = rows.some(row => row.cogs === null) ? null : rows.reduce((total, row) => total + (row.cogs ?? 0), 0);
  const averageStockValue = rows.some(row => row.averageStockValue === null) ? null : rows.reduce((total, row) => total + (row.averageStockValue ?? 0), 0);
  return { count: rows.length, stock: sum('stock'), quantity: sum('quantity'), revenue: sum('revenue'), cogs, averageStockValue,
    completeCount: rows.filter(row => row.completeHistory).length,
    estimatedKoz: cogs !== null && averageStockValue !== null && averageStockValue > 0 ? cogs / averageStockValue : null };
}
export const PERFORMANCE_SORTS = ['sku','name','stock','quantity','revenue','cogs','availableDays','dailyQty','dailyRevenue','averageStockValue','estimatedKoz','coverageDays'] as const;
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
