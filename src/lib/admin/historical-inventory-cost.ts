export type HistoricalPurchasePrice = {
  from: string; to: string | null; unitCost: number | null;
};
export type HistoricalCostEvent = {
  at: string; unitCost: number | null; source: 'fiscal' | 'booking' | 'receipt';
  incomingQty?: number | null; incomingCost?: number | null; beforeStock?: number | null;
};
export type HistoricalCosts = {
  purchasePrices: HistoricalPurchasePrice[];
  costEvents: HistoricalCostEvent[];
};

const priority = { receipt: 0, booking: 1, fiscal: 2 };

/** Legacy receipts already contain historical exchange rates and landed costs.
 * Rebuild their weighted COGS only when the prior stock valuation is known.
 */
export function reconstructReceiptCosts(costs: HistoricalCosts): HistoricalCosts {
  const costEvents: HistoricalCostEvent[] = [];
  const sorted = [...costs.costEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || priority[a.source] - priority[b.source]);
  for (const event of sorted) {
    if (event.source !== 'receipt' || !event.incomingQty || event.incomingQty <= 0 || event.incomingCost == null || event.beforeStock == null ||
      !Number.isFinite(event.incomingQty) || !Number.isFinite(event.incomingCost) || event.incomingCost < 0 || !Number.isFinite(event.beforeStock)) {
      costEvents.push(event); continue;
    }
    const previous = historicalCostAt({ ...costs, costEvents }, Date.parse(event.at));
    const beforeQty = Math.max(0, event.beforeStock);
    const unitCost = beforeQty > 0 && !previous ? null
      : Math.round(((beforeQty * (previous?.unitCost ?? 0) + event.incomingCost) / (beforeQty + event.incomingQty)) * 100) / 100;
    costEvents.push({ ...event, unitCost, source: unitCost === null ? 'receipt' : 'booking' });
  }
  return { ...costs, costEvents };
}

/** A receipt without a booked valuation ends the previous COGS observation.
 * Dated RSD purchase prices cover intervals without a recorded COGS. Foreign
 * quotes remain unknown: a present-day exchange rate must never value history.
 */
export function historicalCostAt(costs: HistoricalCosts, at: number) {
  let event: HistoricalCostEvent | undefined;
  for (const candidate of costs.costEvents) {
    const time = Date.parse(candidate.at);
    if (time > at || !Number.isFinite(time)) continue;
    if (!event || time > Date.parse(event.at) ||
      (time === Date.parse(event.at) && priority[candidate.source] > priority[event.source])) event = candidate;
  }
  if (event?.unitCost !== null && event?.unitCost !== undefined && Number.isFinite(event.unitCost) && event.unitCost >= 0) {
    return { unitCost: event.unitCost, source: event.source };
  }
  let price: HistoricalPurchasePrice | undefined;
  for (const candidate of costs.purchasePrices) {
    const from = Date.parse(candidate.from), to = candidate.to ? Date.parse(candidate.to) : Infinity;
    if (from <= at && at < to && (!price || from >= Date.parse(price.from))) price = candidate;
  }
  return price?.unitCost !== null && price?.unitCost !== undefined && Number.isFinite(price.unitCost) && price.unitCost >= 0
    ? { unitCost: price.unitCost, source: 'purchase-price' as const } : null;
}

export function historicalCostBoundaries(costs: HistoricalCosts, start: number, end: number) {
  return [...new Set([
    ...costs.costEvents.map(event => Date.parse(event.at)),
    ...costs.purchasePrices.flatMap(price => [Date.parse(price.from), ...(price.to ? [Date.parse(price.to)] : [])]),
  ].filter(time => time > start && time < end))].sort((a, b) => a - b);
}
