import 'server-only';
import { db } from '@/lib/db';
import { resolveStoredWarehouseBalance } from '@/lib/reservation-stock';
import { type ExportQuery, money } from './contract';
import { primaryRootCategory } from './category-root';

export async function exportProducts(q: ExportQuery) {
  const categoryTree=await db.category.findMany({select:{id:true,name:true,parentId:true,path:true}});
  const rows = await db.product.findMany({ where: { id: { gt: q.after } }, take: q.limit + 1, orderBy: { id: 'asc' }, select: {
    id: true, sku: true, name: true, shortName: true, shortDescription: true, articleStatus: true, isActive: true, deletedAt: true, stock: true,
    supplier: { select: { id: true, name: true, deliveryDays: true, transitDays: true } }, group: { select: { id: true, name: true } }, collection: { select: { id: true, name: true } },
    categories: { select: { category: { select: { id: true, name: true } } } },
    media: { where: { kind: 'IMAGE' }, orderBy: { order: 'asc' }, take: 1, select: { url: true } },
    colorPrimary: true, colorSecondary: true, cogs: true, grossWeightKg: true, packGrossWeightKg: true,
    unitPackWidthCm: true, unitPackDepthCm: true, unitPackHeightCm: true, packWidthCm: true, packDepthCm: true, packHeightCm: true, packQty: true, containerQty: true,
    fullPrice: true, salePrice: true, loyaltyPrice: true, loyaltyDiscountPct: true, isHero: true,
    priceListEntries: { where: { priceList: { code: { contains: 'ANANAS', mode: 'insensitive' } } }, select: { price: true, validFrom: true, validTo: true, priceList: { select: { code: true, active: true } } } },
    createdAt: true, updatedAt: true,
  } });
  return rows.map(p => ({ ...p, analyticsCategory:primaryRootCategory(p.categories.map(x=>x.category.id),categoryTree), catalogEligible: !p.deletedAt && (p.stock > 0 || p.articleStatus === 'SP'),
    cogsNet: money(p.cogs), fullPriceGross: money(p.fullPrice), salePriceGross: money(p.salePrice), loyaltyPriceGross: money(p.loyaltyPrice),
    ananasPriceHistory: p.priceListEntries, ananasCurrentPrice: null,
    notes: ['Ananas current remote catalog price is not synchronized by this endpoint; price-list entries and actual order prices are separate sources.'],
  }));
}
export async function exportInventory(q: ExportQuery) {
  const rows = await db.product.findMany({ where: { id: { gt: q.after } }, take: q.limit + 1, orderBy: { id: 'asc' }, select: {
    id: true, sku: true, articleStatus: true, deletedAt: true, stock: true, incomingStock: true, supplierStock: true, supplierReservedStock: true,
    warehouseStocks: { where: { warehouse: { active: true } }, select: { qty: true, warehouse: { select: { id: true, code: true, name: true, isDefault: true } } } },
    orderItems: { where: { warehouseReservedQty: { gt: 0 }, order: { status: { notIn: ['ISPORUCENO', 'OTKAZANO', 'VRACENO'] } } }, select: { warehouseId: true, warehouseReservedQty: true, stockMovements: { select: { qty: true } } } },
    partnerReservations: { where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { warehouseId: true, qty: true } },
  } });
  return rows.map(p => {
    const warehouses = p.warehouseStocks.map(s => ({ ...s.warehouse, ...resolveStoredWarehouseBalance({ storedQty: s.qty,
      orderReservations: p.orderItems.filter(r => r.warehouseId === s.warehouse.id || (!r.warehouseId && s.warehouse.isDefault)).map(r => ({ qty: r.warehouseReservedQty, debited: r.stockMovements.reduce((sum, m) => sum + m.qty, 0) < 0 })),
      partnerReserved: p.partnerReservations.filter(r => r.warehouseId === s.warehouse.id).reduce((sum, r) => sum + r.qty, 0),
    }) }));
    return { id: p.id, sku: p.sku, deletedAt: p.deletedAt, catalogEligible: !p.deletedAt && (warehouses.some(w => w.physical > 0) || p.articleStatus === 'SP'),
      physical: warehouses.reduce((sum, w) => sum + w.physical, 0), reserved: warehouses.reduce((sum, w) => sum + w.reserved, 0),
      available: warehouses.reduce((sum, w) => sum + w.available, 0), incoming: p.incomingStock,
      supplierStock: p.supplierStock, supplierReserved: p.supplierReservedStock, warehouses };
  });
}
export async function exportPromotions(q: ExportQuery) {
  return db.action.findMany({ where: { id: { gt: q.after }, startsAt: { lt: q.period.endExclusive }, endsAt: { gte: q.period.start } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, name: true, slug: true, kind: true, isHero: true, isPermanent: true, startsAt: true, endsAt: true, updatedAt: true,
      actionPrices: { select: { salePrice: true, product: { select: { id: true, sku: true } } } }, heroes: { select: { productSku: true, month: true, year: true } } } });
}
export async function exportPurchaseOrders(q: ExportQuery) {
  return db.purchaseOrder.findMany({ where: { id: { gt: q.after }, createdAt: { gte: q.period.start, lt: q.period.endExclusive },
    ...(q.status ? { status: q.status as 'DRAFT' | 'SENT' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED' } : {}) }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, number: true, status: true, orderDate: true, deliveryDate: true, currency: true, exchangeRate: true, totalPrice: true, totalVolume: true,
      supplier: { select: { id: true, name: true } }, createdAt: true, updatedAt: true,
      items: { select: { id: true, sku: true, name: true, qty: true, receivedQty: true, purchasePrice: true, currency: true, totalVolume: true, customsRate: true } } } });
}
export async function exportInboundInvoices(q: ExportQuery) {
  const rows = await db.inboundInvoice.findMany({ where: { id: { gt: q.after }, status: 'POSTED', OR: [
    { invoiceDate: { gte: q.period.start, lt: q.period.endExclusive } }, { invoiceDate: null, createdAt: { gte: q.period.start, lt: q.period.endExclusive } },
  ] }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, number: true, type: true, status: true, invoiceDate: true, lockedAt: true, currency: true, exchangeRate: true, netValue: true, vatValue: true, grossValue: true,
      invoiceValueRsd: true, customsValueRsd: true, transportValueRsd: true, otherRelatedCostsRsd: true, cogsStatus: true, createdAt: true, updatedAt: true,
      supplier: { select: { id: true, name: true } }, purchaseOrder: { select: { id: true, number: true } } } });
  return rows.map(row => ({ ...row, importVat: null, importVatStatus: 'NOT_SEPARATELY_RECORDED', recordedInvoiceVat: money(row.vatValue) }));
}

export async function exportPrices(q: ExportQuery) {
  return db.product.findMany({ where: { id: { gt: q.after } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, sku: true, deletedAt: true, fullPrice: true, salePrice: true, loyaltyPrice: true, loyaltyDiscountPct: true, isHero: true, updatedAt: true,
      priceListEntries: { select: { id: true, price: true, validFrom: true, validTo: true, priceList: { select: { id: true, code: true, name: true, currency: true, active: true } } } },
      loyaltyPriceHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, oldPrice: true, newPrice: true, createdAt: true } },
      purchasePrices: { select: { id: true, price: true, currency: true, validFrom: true, validTo: true } },
    } });
}
export async function exportLoyaltyRules(q: ExportQuery) {
  return db.loyaltyRule.findMany({ where: { id: { gt: q.after } }, orderBy: { id: 'asc' }, take: q.limit + 1,
    select: { id: true, name: true, discountPct: true, scope: true, priority: true, active: true, startsAt: true, endsAt: true, updatedAt: true,
      products: { select: { product: { select: { id: true, sku: true } } } } } });
}
