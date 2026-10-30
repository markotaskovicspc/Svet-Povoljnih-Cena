import { dateInputInTimeZone } from './report-period';

export type FiscalCostObservation = {
  day: string;
  unitCogs: number;
  estimated: boolean;
  through?: string | null;
};
export type FiscalCostHistory = {
  receipts: FiscalCostObservation[];
  prices: FiscalCostObservation[];
  current: number | null;
};
export type FiscalCost = { unitCogs: number | null; estimated: boolean };
const valid = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0;

/** Saved fiscal costs remain authoritative. Unsaved costs are resolved afresh
 * on every read so backdated invoices replace temporary fallback values.
 */
export function resolveFiscalCogs(history: FiscalCostHistory | undefined, at: Date, snapshot?: number | null, fallback: 'any' | 'opening-only' = 'any'): FiscalCost {
  if (valid(snapshot)) return { unitCogs: snapshot, estimated: false };
  if (!history) return { unitCogs: null, estimated: false };
  const day = dateInputInTimeZone(at);
  const latest = (rows: FiscalCostObservation[]) => rows.filter(row =>
    valid(row.unitCogs) && row.day <= day && (!row.through || row.through >= day)
  ).at(-1);
  const dated = latest(history.receipts) ?? latest(history.prices);
  if (dated) return { unitCogs: dated.unitCogs, estimated: dated.estimated };
  // Receipt booking must never value old stock with a later receipt/quote.
  // An undated legacy opening cost remains usable only without dated history.
  if (fallback === 'opening-only') {
    const opening = !history.receipts.length && !history.prices.length && valid(history.current);
    return { unitCogs: opening ? history.current : null, estimated: Boolean(opening) };
  }
  const first = [...history.receipts, ...history.prices].filter(row => valid(row.unitCogs))
    .sort((a, b) => a.day.localeCompare(b.day))[0];
  if (first) return { unitCogs: first.unitCogs, estimated: true };
  return { unitCogs: valid(history.current) ? history.current : null, estimated: valid(history.current) };
}
