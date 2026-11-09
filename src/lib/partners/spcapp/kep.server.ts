import 'server-only';
import { db } from '@/lib/db';
import { dateInputInTimeZone } from '@/lib/admin/report-period';
import { dispatchAccountingDate, isAnanasName, receiptAccountingDate } from '@/lib/admin/kep-ledger';
import { readRetailValueSnapshot } from '@/lib/admin/retail-value-snapshot';
import { ananasMerchandiseItems, fiscalMerchandiseAmounts } from '@/lib/admin/fiscal-merchandise';
import { ananasInventorySku } from '@/lib/ananas/inventory-plan';
import { getAnanasInventoryPolicy } from '@/lib/ananas/inventory.server';
import { ExportInputError, type ExportQuery } from './contract';
import {
  KEP_DOCUMENT_TYPE, discountDifference, entryFromLines, entryId, fiscalLineWarehouse, lineValue, mpcFor,
  pageEntries, qtyAt, roundKep, sortEntries, type KepEntry, type KepKind, type KepLine, type KepWarehouse, type RetailPrice,
} from './kep';

/*
 * KEP po magacinu (SPC Analytics, Marko 09.11.2026). Samo čitanje postojećih dokumenata:
 * prijemnice (primljene nabavne porudžbenice), interne otpremnice i otpremnice Ananasu (prenos),
 * fiskalni računi SPC i Ananas (dnevni promet, povraćaj), popust pri fiskalizaciji i promena MP cene (nivelacija),
 * popis (STOCK_COUNT) i početno stanje (OPENING_BALANCE). Ručne korekcije (ADJUSTMENT) se ne knjiže.
 */
const MAX_DAYS = 31;
type Line = KepLine & { fallback?: boolean };

async function warehouses() {
  const list = await db.warehouse.findMany({ select: { id: true, code: true, name: true, isDefault: true, active: true } });
  const byId = new Map<string, KepWarehouse & { isDefault: boolean }>(list.map((w) => [w.id, { id: w.id, code: w.code, name: w.name, isDefault: w.isDefault }]));
  const policy = await getAnanasInventoryPolicy().catch(() => null);
  const named = list.filter((w) => w.active && !w.isDefault && /^ananas$/i.test(w.name.trim()));
  const ananasId = policy?.warehouseId && byId.has(policy.warehouseId) ? policy.warehouseId : named.length === 1 ? named[0].id : null;
  const defaultId = list.find((w) => w.isDefault)?.id ?? null;
  return { byId, ananasId, defaultId };
}

async function retailHistory(productIds: string[]) {
  const map = new Map<string, RetailPrice[]>();
  if (!productIds.length) return map;
  const entries = await db.priceListEntry.findMany({
    where: { productId: { in: productIds }, priceList: { kind: 'RETAIL' } },
    select: { productId: true, price: true, validFrom: true, validTo: true, priceList: { select: { code: true, active: true, validFrom: true, validTo: true } } },
  });
  for (const e of entries) {
    const list = map.get(e.productId) ?? [];
    list.push({ price: Number(e.price), validFrom: e.validFrom, validTo: e.validTo, priceList: e.priceList });
    map.set(e.productId, list);
  }
  return map;
}

async function productInfo(ids: string[], skus: string[] = []) {
  if (!ids.length && !skus.length) return { byId: new Map<string, P>(), bySku: new Map<string, P>() };
  const rows = await db.product.findMany({
    where: { OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(skus.length ? [{ sku: { in: skus } }] : [])] },
    select: { id: true, sku: true, name: true, fullPrice: true, stock: true },
  });
  const list: P[] = rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, fullPrice: r.fullPrice == null ? null : Number(r.fullPrice), stock: r.stock }));
  return { byId: new Map(list.map((p) => [p.id, p])), bySku: new Map(list.map((p) => [p.sku, p])) };
}
type P = { id: string; sku: string; name: string; fullPrice: number | null; stock: number };

function wh(byId: Map<string, KepWarehouse>, id: string | null) {
  const w = id ? byId.get(id) : undefined;
  return { warehouseId: w?.id ?? null, warehouseCode: w?.code ?? null, warehouseName: w?.name ?? null };
}

/** Vrednosna stavka iz snimka MP vrednosti dokumenta kad se slaže sa stavkama, inače po istorijskoj MP ceni. */
function valuedLines(
  items: Array<{ id: string; productId: string | null; sku: string; name: string | null; qty: number }>,
  snapshotValue: unknown, at: Date, history: Map<string, RetailPrice[]>, products: Map<string, P>,
  savedUnit?: (item: { id: string }) => number | null,
): Line[] {
  const snapshot = readRetailValueSnapshot(snapshotValue);
  const saved = new Map((snapshot?.items ?? []).map((i) => [i.sourceItemId, i]));
  const matches = !!snapshot && snapshot.items.length === items.length && items.every((i) => saved.get(i.id)?.sku === i.sku && saved.get(i.id)?.qty === i.qty);
  return items.map((item) => {
    if (matches) { const unit = saved.get(item.id)!.unitMpc; return { sku: item.sku, name: item.name, qty: item.qty, unitMpc: unit, value: lineValue(item.qty, unit) }; }
    const fromList = mpcFor(item.productId ? history.get(item.productId) : undefined, null, at);
    const unitSaved = fromList.price === null ? savedUnit?.(item) ?? null : null;
    const mpc = fromList.price !== null ? fromList : unitSaved && unitSaved > 0 ? { price: unitSaved, fallback: false } : mpcFor(undefined, item.productId ? products.get(item.productId)?.fullPrice : null, at);
    return { sku: item.sku, name: item.name, qty: item.qty, unitMpc: mpc.price, value: lineValue(item.qty, mpc.price), fallback: mpc.fallback };
  });
}

function base(date: string, w: ReturnType<typeof wh>, kind: KepKind, source: string, extra: { documentNumber: string | null; documentDate?: string | null; partner?: string | null; count?: number }) {
  return { id: entryId(date, w.warehouseCode, kind, source), date, ...w, kind, documentType: KEP_DOCUMENT_TYPE[kind], documentNumber: extra.documentNumber, documentDate: extra.documentDate ?? date, partner: extra.partner ?? null, count: extra.count };
}

export async function kepEntries(q: ExportQuery): Promise<KepEntry[]> {
  const { start, endExclusive } = q.period;
  if (endExclusive.getTime() - start.getTime() > (MAX_DAYS + 1) * 86400000) throw new ExportInputError(`KEP period is limited to ${MAX_DAYS} days.`);
  const inPeriod = (d: Date | null) => !!d && d >= start && d < endExclusive;
  const { byId, ananasId, defaultId } = await warehouses();

  const [orders, notes, fiscalLines, ananasDocs, countMoves, openingMoves, priceChanges] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: 'RECEIVED', postedAt: { not: null } },
      select: { id: true, number: true, postedAt: true, receivingWarehouseId: true, retailValueSnapshot: true, supplier: { select: { name: true } },
        inboundInvoices: { where: { status: 'POSTED' }, take: 1, orderBy: { invoiceDate: 'asc' }, select: { number: true, invoiceDate: true } },
        items: { orderBy: { id: 'asc' }, select: { id: true, productId: true, sku: true, name: true, qty: true } } },
    }),
    db.dispatchNote.findMany({
      where: { status: 'POSTED', postedAt: { not: null }, OR: [{ type: 'INTERNAL' }, { type: 'CUSTOMER', receiverName: { contains: 'Ananas', mode: 'insensitive' } }],
        AND: [{ OR: [{ actualDispatchAt: { gte: start, lt: endExclusive } }, { actualDispatchAt: null, issueDate: { gte: start, lt: endExclusive } }, { actualDispatchAt: null, postedAt: { gte: start, lt: endExclusive } }] }] },
      select: { id: true, number: true, type: true, issueDate: true, actualDispatchAt: true, postedAt: true, sourceWarehouseId: true, destinationWarehouseId: true,
        destinationName: true, receiverName: true, retailValueSnapshot: true, priceList: { select: { code: true, kind: true } },
        items: { orderBy: { id: 'asc' }, select: { id: true, productId: true, sku: true, name: true, qty: true, unitPriceGross: true } } },
    }),
    db.fiscalDocumentLine.findMany({
      where: { fiscalDocument: { is: { kind: { in: ['SALE', 'REFUND'] }, status: 'ISSUED', issuedAt: { gte: start, lt: endExclusive }, order: { is: { channel: { not: 'ANANAS' } } } } } },
      select: { id: true, productId: true, sku: true, shortName: true, qty: true, totalGross: true, totalNet: true, serviceGross: true, vatRate: true, orderItemId: true,
        orderItem: { select: { unitPriceFull: true, warehouseId: true } },
        fiscalDocument: { select: { id: true, kind: true, issuedAt: true, receiptNumber: true, warehouseId: true } } },
    }),
    db.ananasDocument.findMany({ where: { kind: { in: ['SALE', 'REFUND'] }, issuedAt: { gte: start, lt: endExclusive } }, select: { id: true, kind: true, fiscalNumber: true, issuedAt: true, items: true } }),
    db.stockMovement.findMany({ where: { kind: 'STOCK_COUNT', createdAt: { gte: start, lt: endExclusive } }, select: { id: true, warehouseId: true, productId: true, sku: true, qty: true, createdAt: true, dispatchNote: { select: { id: true, number: true } } } }),
    db.stockMovement.findMany({ where: { kind: 'OPENING_BALANCE', createdAt: { gte: start, lt: endExclusive } }, select: { id: true, warehouseId: true, productId: true, sku: true, qty: true, createdAt: true } }),
    db.priceListEntry.findMany({ where: { priceList: { kind: 'RETAIL' }, validFrom: { gte: start, lt: endExclusive } }, select: { productId: true, validFrom: true } }),
  ]);

  const receipts = orders.flatMap((o) => {
    const snap = readRetailValueSnapshot(o.retailValueSnapshot);
    const date = receiptAccountingDate({ receiptDate: o.inboundInvoices[0]?.invoiceDate ?? null, snapshotBookedAt: snap ? new Date(snap.bookedAt) : null, postedAt: o.postedAt });
    return inPeriod(date) ? [{ ...o, date: date! }] : [];
  });
  const fiscalDocIds = [...new Set(fiscalLines.map((l) => l.fiscalDocument.id))];
  const [receiptMoves, fiscalMoves] = await Promise.all([
    receipts.length ? db.stockMovement.findMany({ where: { kind: 'PURCHASE_RECEIPT', OR: receipts.map((r) => ({ idempotencyKey: { startsWith: `purchase-order:${r.id}:` } })) }, select: { idempotencyKey: true, warehouseId: true, qty: true } }) : [],
    fiscalDocIds.length ? db.stockMovement.findMany({ where: { fiscalDocumentId: { in: fiscalDocIds }, kind: { in: ['SALE_RESERVATION', 'REFUND_RETURN'] } }, select: { fiscalDocumentId: true, orderItemId: true, warehouseId: true } }) : [],
  ]);

  const ananasItems = ananasDocs.flatMap((d) => ananasMerchandiseItems(d.items).map((i, index) => ({ doc: d, index, sku: ananasInventorySku(i.sku), name: i.name, qty: i.quantity, gross: i.gross })));
  const productIds = [...new Set([
    ...receipts.flatMap((r) => r.items.flatMap((i) => (i.productId ? [i.productId] : []))),
    ...notes.flatMap((n) => n.items.flatMap((i) => (i.productId ? [i.productId] : []))),
    ...fiscalLines.flatMap((l) => (l.productId ? [l.productId] : [])),
    ...countMoves.flatMap((m) => (m.productId ? [m.productId] : [])),
    ...openingMoves.flatMap((m) => (m.productId ? [m.productId] : [])),
    ...priceChanges.map((p) => p.productId),
  ])];
  const products = await productInfo(productIds, [...new Set(ananasItems.map((i) => i.sku))]);
  const history = await retailHistory([...new Set([...productIds, ...[...products.bySku.values()].map((p) => p.id)])]);
  const entries: KepEntry[] = [];
  const day = (d: Date) => dateInputInTimeZone(d);

  // Prijemnice: zaduženje magacina u koji je roba stvarno primljena (kretanja PURCHASE_RECEIPT), po MP ceni na dan prijema.
  for (const r of receipts) {
    const date = day(r.date);
    const byItem = new Map<string, Map<string, number>>();
    for (const m of receiptMoves) {
      if (!m.idempotencyKey?.startsWith(`purchase-order:${r.id}:receive:`)) continue;
      const itemId = m.idempotencyKey.split(':')[3];
      const per = byItem.get(itemId) ?? new Map<string, number>();
      per.set(m.warehouseId, (per.get(m.warehouseId) ?? 0) + m.qty);
      byItem.set(itemId, per);
    }
    const lines = valuedLines(r.items, r.retailValueSnapshot, r.date, history, products.byId);
    const perWarehouse = new Map<string | null, Line[]>();
    r.items.forEach((item, index) => {
      const split = byItem.get(item.id);
      const targets: Array<[string | null, number]> = split?.size ? [...split.entries()] : [[r.receivingWarehouseId ?? defaultId, lines[index].qty]];
      for (const [warehouseId, qty] of targets) {
        const l = lines[index];
        const list = perWarehouse.get(warehouseId) ?? [];
        list.push({ ...l, qty, value: lineValue(qty, l.unitMpc) });
        perWarehouse.set(warehouseId, list);
      }
    });
    for (const [warehouseId, list] of perWarehouse) {
      const w = wh(byId, warehouseId);
      entries.push(entryFromLines(base(date, w, 'RECEIPT', r.id, { documentNumber: r.inboundInvoices[0]?.number ?? r.number, partner: r.supplier?.name ?? null }), 'debit', 1, list));
    }
  }

  // Prenos (čl. 15 st. 4 t. 2): primalac zadužuje, izdavalac upisuje storno zaduženja; ista vrednost na obe strane.
  for (const n of notes) {
    const snap = readRetailValueSnapshot(n.retailValueSnapshot);
    const at = dispatchAccountingDate({ actualDispatchAt: n.actualDispatchAt, issueDate: n.issueDate, snapshotBookedAt: snap ? new Date(snap.bookedAt) : null, postedAt: n.postedAt })!;
    if (!inPeriod(at)) continue;
    const destination = n.destinationWarehouseId ?? (n.type === 'CUSTOMER' || isAnanasName(n.destinationName) ? ananasId : null);
    if (n.type === 'INTERNAL' && destination === n.sourceWarehouseId) continue;
    const lines = valuedLines(n.items, n.retailValueSnapshot, at, history, products.byId,
      (item) => { const it = n.items.find((x) => x.id === item.id); return n.priceList?.kind === 'RETAIL' && n.priceList.code.toUpperCase() === 'MP' && it ? Number(it.unitPriceGross) : null; });
    const date = day(at), source = wh(byId, n.sourceWarehouseId), target = wh(byId, destination);
    entries.push(entryFromLines(base(date, source, 'TRANSFER_OUT', n.id, { documentNumber: n.number, partner: target.warehouseName ?? n.destinationName ?? n.receiverName }), 'debit', -1, lines));
    entries.push(entryFromLines(base(date, target, 'TRANSFER_IN', n.id, { documentNumber: n.number, partner: source.warehouseName }), 'debit', 1, lines));
  }

  // Fiskalni promet SPC: dnevno razduženje po magacinu iz kog je roba izdata (samo roba, bez dostave i montaže); povraćaj je storno razduženja.
  const moveWarehouse = new Map(fiscalMoves.map((m) => [`${m.fiscalDocumentId}|${m.orderItemId}`, m.warehouseId]));
  type Bucket = { w: ReturnType<typeof wh>; date: string; docs: Set<string>; lines: Line[]; discount: Line[] };
  const buckets = new Map<string, Bucket>();
  const bucket = (date: string, w: ReturnType<typeof wh>, kind: 'SALE' | 'REFUND') => {
    const key = `${date}|${w.warehouseId ?? '~'}|${kind}`;
    let b = buckets.get(key);
    if (!b) { b = { w, date, docs: new Set(), lines: [], discount: [] }; buckets.set(key, b); }
    return b;
  };
  for (const l of fiscalLines) {
    const d = l.fiscalDocument;
    if (!d.issuedAt || l.qty <= 0) continue;
    const amounts = fiscalMerchandiseAmounts({ qty: l.qty, totalGross: Math.abs(Number(l.totalGross)), totalNet: Math.abs(Number(l.totalNet)), serviceGross: Math.abs(Number(l.serviceGross)), vatRate: Number(l.vatRate) });
    if (amounts.gross <= 0) continue;
    const warehouseId = fiscalLineWarehouse({ movementWarehouseId: moveWarehouse.get(`${d.id}|${l.orderItemId}`), orderItemWarehouseId: l.orderItem?.warehouseId, documentWarehouseId: d.warehouseId });
    const kind = d.kind === 'REFUND' ? 'REFUND' : 'SALE';
    const b = bucket(day(d.issuedAt), wh(byId, warehouseId), kind);
    b.docs.add(d.id);
    b.lines.push({ sku: l.sku, name: l.shortName, qty: l.qty, unitMpc: amounts.unit, value: amounts.gross });
    const full = l.orderItem?.unitPriceFull != null ? { price: Number(l.orderItem.unitPriceFull), fallback: false } : mpcFor(l.productId ? history.get(l.productId) : undefined, l.productId ? products.byId.get(l.productId)?.fullPrice : null, d.issuedAt);
    if (full.price === null) b.discount.push({ sku: l.sku, name: l.shortName, qty: l.qty, unitMpc: null, value: null, actualMpc: amounts.unit });
    else if (Math.abs(full.price - amounts.unit) >= 0.005) b.discount.push({ sku: l.sku, name: l.shortName, qty: l.qty, unitMpc: full.price, value: discountDifference(kind, l.qty, full.price, amounts.unit), fallback: full.fallback });
  }
  // Ananas: magacin Ananas (politika lagera ERP-a).
  for (const i of ananasItems) {
    const kind = i.doc.kind === 'REFUND' ? 'REFUND' : 'SALE';
    const b = bucket(day(i.doc.issuedAt), wh(byId, ananasId), kind);
    b.docs.add(i.doc.id);
    const unit = i.qty ? roundKep(i.gross / i.qty) : 0;
    b.lines.push({ sku: i.sku, name: i.name, qty: i.qty, unitMpc: unit, value: i.gross });
    const p = products.bySku.get(i.sku);
    const full = mpcFor(p ? history.get(p.id) : undefined, p?.fullPrice, i.doc.issuedAt);
    if (full.price === null) b.discount.push({ sku: i.sku, name: i.name, qty: i.qty, unitMpc: null, value: null, actualMpc: unit });
    else if (Math.abs(full.price - unit) >= 0.005) b.discount.push({ sku: i.sku, name: i.name, qty: i.qty, unitMpc: full.price, value: discountDifference(kind, i.qty, full.price, unit), fallback: full.fallback });
  }
  for (const [key, b] of buckets) {
    const refund = key.endsWith('|REFUND');
    entries.push(entryFromLines(base(b.date, b.w, refund ? 'SALES_REFUND' : 'SALES', b.date, { documentNumber: null, count: b.docs.size }), 'credit', refund ? -1 : 1, b.lines));
    if (b.discount.length) entries.push(entryFromLines(base(b.date, b.w, 'DISCOUNT', `${b.date}-${refund ? 'R' : 'S'}`, { documentNumber: null, count: b.discount.length }), 'debit', 1, b.discount));
  }

  // Popis (čl. 16): višak u zaduženje, manjak u razduženje, po MP ceni na dan popisa.
  const counts = new Map<string, { w: ReturnType<typeof wh>; date: string; number: string | null; surplus: Line[]; shortage: Line[] }>();
  for (const m of countMoves) {
    const date = day(m.createdAt), key = `${m.dispatchNote?.id ?? date}|${m.warehouseId}`;
    const c = counts.get(key) ?? { w: wh(byId, m.warehouseId), date, number: m.dispatchNote?.number ?? null, surplus: [], shortage: [] };
    const mpc = mpcFor(m.productId ? history.get(m.productId) : undefined, m.productId ? products.byId.get(m.productId)?.fullPrice : null, m.createdAt);
    const qty = Math.abs(m.qty);
    (m.qty > 0 ? c.surplus : c.shortage).push({ sku: m.sku, name: m.productId ? products.byId.get(m.productId)?.name ?? null : null, qty, unitMpc: mpc.price, value: lineValue(qty, mpc.price), fallback: mpc.fallback });
    counts.set(key, c);
  }
  for (const [key, c] of counts) {
    const source = key.split('|')[0];
    if (c.surplus.length) entries.push(entryFromLines(base(c.date, c.w, 'STOCK_COUNT', `${source}-visak`, { documentNumber: c.number }), 'debit', 1, c.surplus));
    if (c.shortage.length) entries.push(entryFromLines(base(c.date, c.w, 'STOCK_COUNT', `${source}-manjak`, { documentNumber: c.number }), 'credit', 1, c.shortage));
  }

  // Početno stanje upisano u ERP-u (kretanje OPENING_BALANCE).
  const openings = new Map<string, { w: ReturnType<typeof wh>; date: string; lines: Line[] }>();
  for (const m of openingMoves) {
    const date = day(m.createdAt), key = `${date}|${m.warehouseId}`;
    const o = openings.get(key) ?? { w: wh(byId, m.warehouseId), date, lines: [] };
    const mpc = mpcFor(m.productId ? history.get(m.productId) : undefined, m.productId ? products.byId.get(m.productId)?.fullPrice : null, m.createdAt);
    o.lines.push({ sku: m.sku, name: m.productId ? products.byId.get(m.productId)?.name ?? null : null, qty: m.qty, unitMpc: mpc.price, value: lineValue(m.qty, mpc.price), fallback: mpc.fallback });
    openings.set(key, o);
  }
  for (const [key, o] of openings) entries.push(entryFromLines(base(o.date, o.w, 'OPENING_BALANCE', key, { documentNumber: null }), 'debit', 1, o.lines));

  // Promena MP cene (nivelacija): (nova − stara MPC) × količina u magacinu u trenutku promene.
  const changeIds = [...new Set(priceChanges.map((p) => p.productId))];
  if (changeIds.length) {
    const [stocks, later] = await Promise.all([
      db.warehouseStock.findMany({ where: { productId: { in: changeIds } }, select: { productId: true, warehouseId: true, qty: true } }),
      db.stockMovement.findMany({ where: { productId: { in: changeIds }, createdAt: { gte: start } }, select: { productId: true, warehouseId: true, qty: true, createdAt: true } }),
    ]);
    const current = new Map<string, number>(), split = new Map<string, number>();
    for (const s of stocks) { current.set(`${s.productId}|${s.warehouseId}`, s.qty); split.set(s.productId, (split.get(s.productId) ?? 0) + s.qty); }
    // Stari lager još neraspoređen po magacinima ERP vodi kao SPC lager; knjiži se u podrazumevani magacin.
    if (defaultId) for (const id of changeIds) {
      const residual = Math.max(0, (products.byId.get(id)?.stock ?? 0) - (split.get(id) ?? 0));
      if (residual) current.set(`${id}|${defaultId}`, (current.get(`${id}|${defaultId}`) ?? 0) + residual);
    }
    const moves = new Map<string, Array<{ createdAt: Date; qty: number }>>();
    for (const m of later) { const k = `${m.productId}|${m.warehouseId}`; const list = moves.get(k) ?? []; list.push(m); moves.set(k, list); }
    const perDay = new Map<string, { w: ReturnType<typeof wh>; date: string; lines: Line[] }>();
    for (const productId of changeIds) {
      const h = history.get(productId) ?? [], p = products.byId.get(productId);
      const dates = [...new Map(priceChanges.filter((c) => c.productId === productId).map((c) => [c.validFrom.getTime(), c.validFrom])).values()].sort((a, b) => a.getTime() - b.getTime());
      for (const at of dates) {
        const before = mpcFor(h, null, new Date(at.getTime() - 1)).price, after = mpcFor(h, null, at).price;
        if (before === null || after === null || Math.abs(before - after) < 0.005) continue;
        for (const [key, qtyNow] of current) {
          if (!key.startsWith(productId + '|')) continue;
          const warehouseId = key.slice(productId.length + 1), qty = qtyAt(qtyNow, moves.get(key) ?? [], at);
          if (!qty) continue;
          const date = day(at), k = `${date}|${warehouseId}`;
          const g = perDay.get(k) ?? { w: wh(byId, warehouseId), date, lines: [] };
          g.lines.push({ sku: p?.sku ?? productId, name: p?.name ?? null, qty, unitMpc: after, value: roundKep((after - before) * qty) });
          perDay.set(k, g);
        }
      }
    }
    for (const [key, g] of perDay) entries.push(entryFromLines(base(g.date, g.w, 'PRICE_CHANGE', key, { documentNumber: 'Cenovnik MP', count: g.lines.length }), 'debit', 1, g.lines));
  }

  return pageEntries(sortEntries(entries), q.after, q.limit);
}

/** Početno stanje knjige: vrednost zaliha po magacinu na početku dana `from` (sadašnje stanje − kretanja od tog trenutka) × MP cena tog trenutka. */
export async function kepOpening(q: ExportQuery) {
  if (q.period.fromInput !== q.period.toInput) throw new ExportInputError('kep-opening requires from = to.');
  const at = q.period.start;
  const { byId, defaultId } = await warehouses();
  const [stocks, later, all] = await Promise.all([
    db.warehouseStock.findMany({ select: { productId: true, warehouseId: true, qty: true } }),
    db.stockMovement.findMany({ where: { createdAt: { gte: at }, productId: { not: null } }, select: { productId: true, warehouseId: true, qty: true, createdAt: true } }),
    db.product.findMany({ select: { id: true, sku: true, name: true, fullPrice: true, stock: true } }),
  ]);
  const qty = new Map<string, number>(), split = new Map<string, number>();
  for (const s of stocks) { qty.set(`${s.warehouseId}|${s.productId}`, s.qty); split.set(s.productId, (split.get(s.productId) ?? 0) + s.qty); }
  if (defaultId) for (const p of all) { const r = Math.max(0, p.stock - (split.get(p.id) ?? 0)); if (r) qty.set(`${defaultId}|${p.id}`, (qty.get(`${defaultId}|${p.id}`) ?? 0) + r); }
  for (const m of later) { const k = `${m.warehouseId}|${m.productId}`; qty.set(k, (qty.get(k) ?? 0) - m.qty); }
  const ids = [...new Set([...qty].filter(([, v]) => v).map(([k]) => k.split('|')[1]))];
  const history = await retailHistory(ids);
  const product = new Map(all.map((p) => [p.id, p]));
  const result = new Map<string, { lines: Line[] }>();
  for (const [key, v] of qty) {
    if (!v) continue;
    const [warehouseId, productId] = key.split('|'), p = product.get(productId);
    const mpc = mpcFor(history.get(productId), p?.fullPrice == null ? null : Number(p.fullPrice), at);
    const r = result.get(warehouseId) ?? { lines: [] };
    r.lines.push({ sku: p?.sku ?? productId, name: p?.name ?? null, qty: v, unitMpc: mpc.price, value: lineValue(v, mpc.price), fallback: mpc.fallback });
    result.set(warehouseId, r);
  }
  const date = q.period.fromInput;
  const rows = [...result].map(([warehouseId, r]) => {
    const e = entryFromLines(base(date, wh(byId, warehouseId), 'OPENING_BALANCE', 'state', { documentNumber: null, count: r.lines.length }), 'debit', 1, r.lines);
    // Stavke samo za artikle bez MP cene, da SPC Analytics može da ih dopuni ručno.
    return { ...e, id: warehouseId, knownValue: roundKep(r.lines.reduce((sum, l) => sum + (l.value ?? 0), 0)), lines: r.lines.filter((l) => l.value === null).slice(0, 2000).map(({ fallback: _f, ...l }) => l), negativeQtySkus: r.lines.filter((l) => l.qty < 0).map((l) => l.sku).slice(0, 200) };
  });
  return pageEntries(rows.sort((a, b) => (a.id < b.id ? -1 : 1)), q.after, q.limit);
}
