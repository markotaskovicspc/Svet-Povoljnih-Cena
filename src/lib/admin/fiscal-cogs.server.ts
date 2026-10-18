import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { weightedAverageCogs } from './inbound-invoice';
import { resolveFiscalCogs, type FiscalCostHistory } from './fiscal-cogs';

type CostDatabase = Pick<Prisma.TransactionClient, 'product' | 'purchasePrice' | 'inboundInvoice' | 'ananasDocument'>;

export async function loadFiscalCogs(skus: readonly string[], tx: CostDatabase = db) {
  const unique = [...new Set(skus.filter(Boolean))];
  const history = new Map<string, FiscalCostHistory>();
  if (!unique.length) return (sku: string, at: Date, snapshot?: number | null) => resolveFiscalCogs(history.get(sku), at, snapshot);
  const [products, prices, invoices] = await Promise.all([
    tx.product.findMany({ where: { sku: { in: unique } }, select: { sku: true, cogs: true } }),
    tx.purchasePrice.findMany({ where: { sku: { in: unique }, currency: 'RSD' }, orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    tx.inboundInvoice.findMany({
      where: { status: 'POSTED', lockedAt: { not: null }, purchaseOrder: { is: { items: { some: { sku: { in: unique } } } } } },
      orderBy: [{ invoiceDate: 'asc' }, { lockedAt: 'asc' }, { id: 'asc' }],
      select: { invoiceDate: true, lockedAt: true, purchaseOrder: { select: {
        exchangeRate: true, cogsBookingSnapshot: true,
        items: { select: { sku: true, productId: true, qty: true, purchasePrice: true, customsRate: true, freightAllocated: true, additionalCostAllocated: true } },
      } } },
    }),
  ]);
  for (const sku of unique) history.set(sku, { receipts: [], prices: [], current: null });
  for (const product of products) history.get(product.sku)!.current = product.cogs == null ? null : Number(product.cogs);
  for (const price of prices) history.get(price.sku)!.prices.push({
    day: price.validFrom.toISOString().slice(0, 10), through: price.validTo?.toISOString().slice(0, 10),
    unitCogs: Number(price.price), estimated: true,
  });
  for (const invoice of invoices) {
    const order = invoice.purchaseOrder;
    if (!order) continue;
    const snapshot = order.cogsBookingSnapshot as { version?: number; products?: { productId: string; sku: string; stock: number; cogs: number | null }[] } | null;
    const before = snapshot?.version === 1 && Array.isArray(snapshot.products) ? snapshot.products : [];
    const incoming = new Map<string, { qty: number; cost: number; productId: string | null }>();
    for (const item of order.items) {
      if (!history.has(item.sku) || item.qty <= 0) continue;
      const row = incoming.get(item.sku) ?? { qty: 0, cost: 0, productId: item.productId };
      row.qty += item.qty;
      // Same persisted landed-cost components used by inbound invoice posting.
      row.cost += item.qty * Number(item.purchasePrice) * Number(order.exchangeRate) * (1 + Number(item.customsRate ?? 0) / 100)
        + Number(item.freightAllocated ?? 0) + Number(item.additionalCostAllocated ?? 0);
      incoming.set(item.sku, row);
    }
    for (const [sku, row] of incoming) {
      const prior = before.find(value => value && (value.productId === row.productId || value.sku === sku));
      const knownPrior = prior && Number.isFinite(prior.stock) && prior.stock >= 0 &&
        (prior.stock === 0 || (prior.cogs != null && Number.isFinite(prior.cogs) && prior.cogs >= 0));
      const unitCogs = knownPrior ? weightedAverageCogs({
        existingQty: prior.stock, existingUnitCogs: prior.cogs ?? row.cost / row.qty,
        incomingQty: row.qty, incomingUnitCogs: row.cost / row.qty,
      }) : Math.round(row.cost / row.qty * 100) / 100;
      history.get(sku)!.receipts.push({ day: (invoice.invoiceDate ?? invoice.lockedAt!).toISOString().slice(0, 10), unitCogs, estimated: !knownPrior });
    }
  }
  for (const value of history.values()) value.receipts.sort((a, b) => a.day.localeCompare(b.day));
  return (sku: string, at: Date, snapshot?: number | null) => resolveFiscalCogs(history.get(sku), at, snapshot);
}

/** Original sales may lie outside the selected refund period or page limit. */
export async function loadAnanasCostDates(documents: readonly { kind: string; reference: string | null }[], tx: CostDatabase = db) {
  const references = [...new Set(documents.filter(doc => doc.kind === 'REFUND').map(doc => doc.reference).filter((value): value is string => Boolean(value)))];
  const sales = references.length ? await tx.ananasDocument.findMany({
    where: { kind: 'SALE', fiscalNumber: { in: references } }, select: { fiscalNumber: true, issuedAt: true },
  }) : [];
  return new Map(sales.map(sale => [sale.fiscalNumber, sale.issuedAt]));
}
