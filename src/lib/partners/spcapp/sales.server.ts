import {shipmentExportReferences} from './shipment-references';
import 'server-only';
import { z } from 'zod';
import { db } from '@/lib/db';
import { loadFiscalCogs, loadAnanasCostDates } from '@/lib/admin/fiscal-cogs.server';
import { ananasFiscalItems, fiscalMerchandiseAmounts, isFiscalService } from '@/lib/admin/fiscal-merchandise';
import { type ExportQuery, customerKey, money, n } from './contract';

export async function exportOrders(q: ExportQuery) {
  const rows = await db.order.findMany({ where: { id: { gt: q.after }, createdAt: { gte: q.period.start, lt: q.period.endExclusive } }, take: q.limit + 1, orderBy: { id: 'asc' }, select: {
    id: true, number: true, channel: true, status: true, customerId: true, userId: true, shipCity: true, createdAt: true, updatedAt: true,
    subtotal: true, savings: true, shipping: true, assemblyTotal: true, firstPurchaseDiscount: true, savedCardDiscount: true, voucherDiscount: true, total: true, paymentMethod: true, courierPaidAt: true,
    items: { select: { id: true, sku: true, qty: true, unitPriceFull: true, unitPriceSale: true, withAssembly: true, assemblyPrice: true } },
    fiscalDocuments: { where: { status: 'ISSUED' }, select: { id: true, receiptNumber: true, kind: true, issuedAt: true } },
    shipments: { select: { id: true, provider: true, service: true, trackingNo: true, providerOrderId: true, providerParcelNumbers: true, status: true } },
    pickupBatchLines: { select: { id: true, shipmentId: true, orderItemId: true, packedQuantity: true, packageNo: true, weightKg: true, widthCm: true, depthCm: true, heightCm: true, providerParcelNumber: true } },
    invoices: { select: { id: true, number: true, kind: true, status: true, issuedAt: true, total: true } },
    payments: { select: { id: true, status: true, amount: true, createdAt: true, updatedAt: true } },
  } });
  return rows.map(({ customerId, userId, shipCity, ...row }) => ({ ...row, channel: 'SPC', erpChannel: row.channel,
    deliveryCity: shipCity,
    shipments: row.shipments.map(s => ({...s,...shipmentExportReferences(s)})),
    customerKey: customerKey({ customerId, userId }), customerIdentityComplete: Boolean(customerId || userId),
    hasFiscalRefund: row.fiscalDocuments.some(d => d.kind === 'REFUND'),
    items: row.items.map(item => ({ ...item, quantity: item.qty,
      grossBeforeOrderDiscounts: money(Number(item.unitPriceSale) * item.qty),
      netBeforeOrderDiscountsEstimate: money(Number(item.unitPriceSale) * item.qty / 1.2), netBasis: 'STANDARD_20_PERCENT_ESTIMATE_USE_FISCAL_FOR_ACTUAL',
    })),
  }));
}
const storedItem = z.object({ id: z.string(), sku: z.string(), name: z.string(), quantity: z.number(), unitPrice: z.number(), gross: z.number(), net: z.number().nullable(), shipping: z.number(), shippingNet: z.number().nullable(), commission: z.number().nullable() });
const storedShipment = z.object({ suborderId: z.string(), status: z.string(), carrierName: z.string().nullable() });
function safeArray<T>(value: unknown, schema: z.ZodType<T>): T[] {
  return Array.isArray(value) ? value.flatMap(item => { const result = schema.safeParse(item); return result.success ? [result.data] : []; }) : [];
}
export async function exportAnanasOrders(q: ExportQuery) {
  const rows = await db.ananasOrder.findMany({ where: { id: { gt: q.after }, createdAt: { gte: q.period.start, lt: q.period.endExclusive } }, take: q.limit + 1, orderBy: { id: 'asc' },
    select: { id: true, createdAt: true, updatedAt: true, total: true, currency: true, paymentMethods: true, status: true, items: true, shipments: true, importedAt: true, lastCheckedAt: true } });
  const docs = rows.length ? await db.ananasDocument.findMany({ where: { orderNumber: { in: rows.map(row => row.id) } }, select: { id: true, orderNumber: true, kind: true, fiscalNumber: true, issuedAt: true } }) : [];
  return rows.map(row => {
    const items = safeArray(row.items, storedItem), shipments = safeArray(row.shipments, storedShipment);
    const fiscalDocuments = docs.filter(d => d.orderNumber === row.id);
    return { ...row, channel: 'ANANAS', number: row.id, customerKey: null, customerIdentityComplete: false,
      items: items.map(item => ({ ...item, gross: money(item.gross), net: money(item.net), unitPrice: money(item.unitPrice), shipping: money(item.shipping), shippingNet: money(item.shippingNet), commission: money(item.commission) })),
      shippingGross: money(items.reduce((sum, item) => sum + item.shipping, 0)),
      shippingNet: items.some(item => item.shippingNet == null) ? null : money(items.reduce((sum, item) => sum + (item.shippingNet ?? 0), 0)),
      firstPurchaseDiscount: null, parcels: null, shipments, fiscalDocuments, hasFiscalRefund: fiscalDocuments.some(d => d.kind === 'REFUND'),
      dataQuality: { skippedItems: Array.isArray(row.items) ? row.items.length - items.length : null, customerIdentity: 'NOT_AVAILABLE', parcelDimensions: 'NOT_CAPTURED' },
    };
  });
}
function costSummary(lines: { quantity: number; service: boolean; unitCogsNet: string | null; totalCogsNet: string | null; cogsEstimated: boolean }[]) {
  const goods = lines.filter(line => !line.service);
  const missingQuantity = goods.filter(line => line.unitCogsNet == null).reduce((sum, line) => sum + line.quantity, 0);
  return { totalCogsNet: missingQuantity ? null : money(goods.reduce((sum, line) => sum + Number(line.totalCogsNet ?? 0), 0)),
    knownCogsSubtotalNet: money(goods.reduce((sum, line) => sum + Number(line.totalCogsNet ?? 0), 0)), missingCogsQuantity: missingQuantity,
    estimatedCogsQuantity: goods.filter(line => line.cogsEstimated).reduce((sum, line) => sum + line.quantity, 0) };
}
export async function exportFiscal(q: ExportQuery) {
  const docs = await db.fiscalDocument.findMany({ where: { id: { gt: q.after }, status: 'ISSUED', issuedAt: { gte: q.period.start, lt: q.period.endExclusive } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, kind: true, receiptNumber: true, issuedAt: true, updatedAt: true, totalGross: true, totalNet: true, totalVat: true,
      order: { select: { id: true, number: true, channel: true, customerId: true, userId: true, firstPurchaseDiscount: true } },
      lines: { select: { id: true, sku: true, shortName: true, qty: true, refundedQty: true, totalGross: true, totalNet: true, serviceGross: true, vatRate: true, unitCogs: true,
        originalSaleLine: { select: { id: true, unitCogs: true, fiscalDocument: { select: { id: true, receiptNumber: true, issuedAt: true } } } } } } } });
  const costAt = await loadFiscalCogs(docs.flatMap(d => d.lines.filter(l => !isFiscalService(l.sku, l.shortName)).map(l => l.sku)));
  return docs.map(doc => {
    const sign = doc.kind === 'REFUND' ? -1 : 1;
    const lines = doc.lines.map(line => {
      const service = isFiscalService(line.sku, line.shortName);
      const shipping = service && !/^(?:MONTA|ASSEMBLY)/i.test(line.sku.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) && !/^Monta/i.test(line.shortName);
      const amounts = fiscalMerchandiseAmounts({ qty: line.qty, totalGross: Number(line.totalGross), totalNet: Number(line.totalNet), serviceGross: Number(line.serviceGross), vatRate: Number(line.vatRate) });
      const valuationAt = (sign < 0 ? line.originalSaleLine?.fiscalDocument.issuedAt : null) ?? doc.issuedAt!;
      const cost = service ? { unitCogs: null, estimated: false } : costAt(line.sku, valuationAt, n(line.unitCogs) ?? (sign < 0 ? n(line.originalSaleLine?.unitCogs) : null));
      return { id: line.id, sku: line.sku, name: line.shortName, quantity: line.qty, signedQuantity: sign * line.qty, refundedQuantity: line.refundedQty,
        service, vatRate: n(line.vatRate), gross: money(sign * Number(line.totalGross)), net: money(sign * Number(line.totalNet)),
        merchandiseGross: money(service ? 0 : sign * amounts.gross), merchandiseNet: money(service ? 0 : sign * amounts.net),
        shippingGross: money(shipping ? sign * Number(line.totalGross) : 0), shippingNet: money(shipping ? sign * Number(line.totalNet) : 0),
        assemblyGross: money(service ? (shipping ? 0 : sign * Number(line.totalGross)) : sign * Number(line.serviceGross)),
        unitCogsNet: money(cost.unitCogs), totalCogsNet: money(cost.unitCogs == null ? null : sign * line.qty * cost.unitCogs), cogsEstimated: cost.estimated, valuationAt,
        originalLineId: line.originalSaleLine?.id ?? null, originalDocument: line.originalSaleLine?.fiscalDocument ?? null };
    });
    return { id: doc.id, channel: 'SPC', erpChannel: doc.order.channel, kind: doc.kind, number: doc.receiptNumber, issuedAt: doc.issuedAt, updatedAt: doc.updatedAt,
      orderId: doc.order.id, orderNumber: doc.order.number, customerKey: customerKey(doc.order),
      gross: money(sign * Number(doc.totalGross)), net: money(sign * Number(doc.totalNet)), vat: money(sign * Number(doc.totalVat)),
      merchandiseQuantity: lines.filter(l => !l.service).reduce((sum, l) => sum + l.quantity, 0),
      multipleMerchandiseUnits: lines.filter(l => !l.service).reduce((sum, l) => sum + l.quantity, 0) > 1,
      orderFirstPurchaseDiscountGross: money(doc.order.firstPurchaseDiscount), firstPurchaseDiscountAllocatedGross: null,
      ...costSummary(lines), lines };
  });
}
export async function exportAnanasFiscal(q: ExportQuery) {
  const docs = await db.ananasDocument.findMany({ where: { id: { gt: q.after }, issuedAt: { gte: q.period.start, lt: q.period.endExclusive }, kind: { in: ['SALE', 'REFUND'] } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, kind: true, fiscalNumber: true, reference: true, orderNumber: true, suborderNumber: true, issuedAt: true, invoicedAt: true, gross: true, net: true, vat: true, items: true, updatedAt: true } });
  const [costAt, originals] = await Promise.all([
    loadFiscalCogs(docs.flatMap(d => ananasFiscalItems(d.items).filter(l => !isFiscalService(l.sku, l.name)).map(l => l.sku))), loadAnanasCostDates(docs),
  ]);
  return docs.map(doc => {
    const sign = doc.kind === 'REFUND' ? -1 : 1;
    const originalDate = doc.reference ? originals.get(doc.reference) : null;
    const valuationAt = (sign < 0 ? originalDate : null) ?? doc.issuedAt;
    const lines = ananasFiscalItems(doc.items).map((item, index) => {
      const service = isFiscalService(item.sku, item.name), shipping = service && !/^MONTA|^ASSEMBLY/i.test(item.sku) && !/^Monta/i.test(item.name);
      const cost = service ? { unitCogs: null, estimated: false } : costAt(item.sku, valuationAt);
      return { id: `${doc.id}:${index}`, sku: item.sku, name: item.name, quantity: item.quantity, signedQuantity: sign * item.quantity, service,
        gross: money(sign * item.gross), net: money(item.net == null ? null : sign * item.net),
        merchandiseGross: money(service ? 0 : sign * item.gross), merchandiseNet: service ? '0.00' : money(item.net == null ? null : sign * item.net),
        shippingGross: money(shipping ? sign * item.gross : 0), shippingNet: shipping ? money(item.net == null ? null : sign * item.net) : '0.00',
        unitCogsNet: money(cost.unitCogs), totalCogsNet: money(cost.unitCogs == null ? null : sign * item.quantity * cost.unitCogs), cogsEstimated: cost.estimated };
    });
    const header = { id: doc.id, kind: doc.kind, fiscalNumber: doc.fiscalNumber, reference: doc.reference, orderNumber: doc.orderNumber, suborderNumber: doc.suborderNumber, issuedAt: doc.issuedAt, invoicedAt: doc.invoicedAt, updatedAt: doc.updatedAt };
    return { ...header, channel: 'ANANAS', number: doc.fiscalNumber, gross: money(sign * Number(doc.gross)), net: money(sign * Number(doc.net)), vat: money(sign * Number(doc.vat)),
      firstPurchaseDiscountAllocatedGross: null, customerKey: null, valuationAt, originalSaleDateMissing: sign < 0 && !originalDate,
      merchandiseQuantity: lines.filter(l => !l.service).reduce((sum, l) => sum + l.quantity, 0), multipleMerchandiseUnits: lines.filter(l => !l.service).reduce((sum, l) => sum + l.quantity, 0) > 1,
      ...costSummary(lines), lines };
  });
}
export async function exportLegacyFiscal(q: ExportQuery) {
  return db.fiscalReceipt.findMany({ where: { id: { gt: q.after }, fiscalizedAt: { gte: q.period.start, lt: q.period.endExclusive }, order: { fiscalDocuments: { none: { status: 'ISSUED', kind: 'SALE' } } } },
    take: q.limit + 1, orderBy: { id: 'asc' }, select: { id: true, receiptNumber: true, fiscalizedAt: true, order: { select: { id: true, number: true, total: true } } } });
}
