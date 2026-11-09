/**
 * KEP po magacinu za SPC Analytics (Pravilnik o evidenciji prometa, Sl. glasnik RS 99/2015, čl. 15–16).
 * Čiste funkcije: bez baze, da bi se pravila mogla testirati.
 * Zaduženje i razduženje su po MP ceni sa PDV-om; smanjenje se iskazuje kao crveni storno (negativan iznos u istoj koloni).
 */
export type KepKind =
  | 'OPENING_BALANCE' | 'RECEIPT' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  | 'SALES' | 'SALES_REFUND' | 'DISCOUNT' | 'PRICE_CHANGE' | 'STOCK_COUNT';

export type KepWarehouse = { id: string; code: string; name: string };
export type KepLine = { sku: string; name: string | null; qty: number; unitMpc: number | null; value: number | null; actualMpc?: number | null };
export type KepEntry = {
  id: string;
  date: string;
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  kind: KepKind;
  documentType: string;
  documentNumber: string | null;
  documentDate: string | null;
  partner: string | null;
  debit: number | null;
  credit: number | null;
  complete: boolean;
  missingMpcSkus: string[];
  fallbackMpcSkus: string[];
  count: number;
  lines: KepLine[];
};

export const KEP_DOCUMENT_TYPE: Record<KepKind, string> = {
  OPENING_BALANCE: 'Početno stanje',
  RECEIPT: 'Prijemnica',
  TRANSFER_IN: 'Prenos – ulaz',
  TRANSFER_OUT: 'Prenos – izlaz',
  SALES: 'Dnevni promet',
  SALES_REFUND: 'Povraćaj',
  DISCOUNT: 'Nivelacija – popust',
  PRICE_CHANGE: 'Nivelacija – promena MP cene',
  STOCK_COUNT: 'Popis',
};

export const MAX_KEP_LINES = 500;
export const roundKep = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type RetailPrice = {
  price: number;
  validFrom: Date;
  validTo: Date | null;
  priceList: { code: string; active: boolean; validFrom: Date | null; validTo: Date | null };
};

/** Važeća MP cena na trenutak `at`: aktivan RETAIL cenovnik, najnoviji validFrom, pa šifra cenovnika (isto kao ERP KEP). */
export function retailPriceAt(history: RetailPrice[], at: Date): number | null {
  const entry = history
    .filter((c) => c.validFrom <= at && (!c.validTo || c.validTo >= at) && c.priceList.active &&
      (!c.priceList.validFrom || c.priceList.validFrom <= at) && (!c.priceList.validTo || c.priceList.validTo >= at))
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime() || a.priceList.code.localeCompare(b.priceList.code))[0];
  return entry && Number.isFinite(entry.price) && entry.price > 0 ? entry.price : null;
}

/** MP cena iz istorije cenovnika, inače iz kartice artikla (označeno kao zamena), inače nema. */
export function mpcFor(history: RetailPrice[] | undefined, fullPrice: number | null | undefined, at: Date) {
  const historical = retailPriceAt(history ?? [], at);
  if (historical !== null) return { price: historical, fallback: false };
  if (fullPrice != null && Number.isFinite(fullPrice) && fullPrice > 0) return { price: fullPrice, fallback: true };
  return { price: null, fallback: false };
}

/** Jedna stavka knjige od linija: vrednost je zbir; ako bilo kojoj liniji fali MP cena, iznos je nepoznat (null). */
export function entryFromLines(base: Omit<KepEntry, 'debit' | 'credit' | 'complete' | 'missingMpcSkus' | 'fallbackMpcSkus' | 'lines' | 'count'> & { count?: number },
  column: 'debit' | 'credit', sign: 1 | -1, lines: Array<KepLine & { fallback?: boolean }>): KepEntry {
  const missing = [...new Set(lines.filter((l) => l.value === null).map((l) => l.sku))];
  const fallback = [...new Set(lines.filter((l) => l.fallback).map((l) => l.sku))];
  const total = missing.length ? null : roundKep(sign * lines.reduce((sum, l) => sum + (l.value ?? 0), 0));
  return {
    ...base,
    count: base.count ?? 1,
    debit: column === 'debit' ? total : null,
    credit: column === 'credit' ? total : null,
    complete: !missing.length,
    missingMpcSkus: missing,
    fallbackMpcSkus: fallback,
    lines: lines.slice(0, MAX_KEP_LINES).map(({ fallback: _f, ...l }) => ({ ...l, value: l.value === null ? null : roundKep(l.value) })),
  };
}

export function lineValue(qty: number, unitMpc: number | null) {
  return unitMpc === null ? null : roundKep(qty * unitMpc);
}

/**
 * Magacin fiskalne stavke: kretanje zaliha vezano za taj račun i stavku porudžbine,
 * pa magacin stavke porudžbine, pa magacin računa. Bez toga nema magacina (ne pogađa se).
 */
export function fiscalLineWarehouse(input: {
  movementWarehouseId: string | null | undefined;
  orderItemWarehouseId: string | null | undefined;
  documentWarehouseId: string | null | undefined;
}) {
  return input.movementWarehouseId ?? input.orderItemWarehouseId ?? input.documentWarehouseId ?? null;
}

/** Količina u magacinu na trenutak `at` = sadašnje stanje − kretanja posle tog trenutka. */
export function qtyAt(current: number, movements: Array<{ createdAt: Date; qty: number }>, at: Date) {
  return current - movements.filter((m) => m.createdAt >= at).reduce((sum, m) => sum + m.qty, 0);
}

/** Popust pri fiskalizaciji: prodaja ispod MP cene smanjuje vrednost zaduženja, povraćaj ga vraća. */
export function discountDifference(kind: 'SALE' | 'REFUND', qty: number, fullMpc: number, actualMpc: number) {
  return roundKep(kind === 'SALE' ? (actualMpc - fullMpc) * qty : (fullMpc - actualMpc) * qty);
}

export function entryId(date: string, warehouseCode: string | null, kind: KepKind, source: string) {
  return `${date}|${warehouseCode ?? '~'}|${kind}|${source}`;
}

export function sortEntries(entries: KepEntry[]) {
  return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Stranica rezultata po id-u (posle kursora), sa jednim viškom za hasMore. */
export function pageEntries<T extends { id: string }>(rows: T[], after: string, limit: number) {
  return rows.filter((r) => r.id > after).slice(0, limit + 1);
}
