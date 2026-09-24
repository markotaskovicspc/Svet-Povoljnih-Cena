import "server-only";
import { db } from "@/lib/db";
import type { ErpRow, SalesOrderExportFilters } from "@/lib/admin/erp";
import type { AnanasOrderItem, AnanasOrderShipment } from "./orders";

export const ananasDetailId = (id: string) => `ananas-${id}`;
export const ananasOrderHref = (id: string) => `/admin/erp/prodajni-nalozi/${encodeURIComponent(ananasDetailId(id))}`;
export async function ananasOrderRows(take: number, filters?: SalesOrderExportFilters): Promise<ErpRow[]> {
  // Remote warehouse identifiers must not be guessed to refer to a local warehouse.
  if (filters?.warehouseId) return [];
  const orders = await db.ananasOrder.findMany({ take, orderBy: { createdAt: "desc" }, where: { createdAt: {
    ...(filters?.createdFrom ? { gte: filters.createdFrom } : {}), ...(filters?.createdToExclusive ? { lt: filters.createdToExclusive } : {}),
  } } });
  const docs = orders.length ? await db.ananasDocument.findMany({ where: { orderNumber: { in: orders.map(o => o.id) } }, select: { orderNumber: true, kind: true, issuedAt: true } }) : [];
  return orders.flatMap(order => {
    const linked = docs.filter(d => d.orderNumber === order.id);
    const sales = linked.filter(d => d.kind === "SALE");
    if (filters?.fiscalized !== undefined && Boolean(sales.length) !== filters.fiscalized) return [];
    if ((filters?.fiscalIssuedFrom || filters?.fiscalIssuedToExclusive) && !sales.some(d => (!filters.fiscalIssuedFrom || d.issuedAt >= filters.fiscalIssuedFrom) && (!filters.fiscalIssuedToExclusive || d.issuedAt < filters.fiscalIssuedToExclusive))) return [];
    const address = order.billingAddress as Record<string, string | null>;
    const shipments = order.shipments as AnanasOrderShipment[];
    const items = order.items as AnanasOrderItem[];
    const detailId = ananasDetailId(order.id);
    const common = { number: order.id, orderDate: order.createdAt.toISOString(), channel: "ANANAS", customer: order.customerName,
      paymentMethod: order.paymentMethods, paymentStatus: "Prema Ananasu", purchaseIdentity: "Ananas",
      address: [address.streetName, address.streetNumber].filter(Boolean).join(" "), city: address.city ?? null, postalCode: address.postcode ?? null,
      pib: address.buyerType === "TIN" ? address.buyerId ?? null : null,
      courierService: [...new Set(shipments.map(s => s.carrierName).filter(Boolean))].join(", ") || "Ananas",
      courierStatus: order.status, fiscalized: sales.length > 0, fiscalizedAt: sales[0]?.issuedAt.toISOString() ?? null,
      invoiced: sales.length > 0, refunded: linked.some(d => d.kind === "REFUND"),
    };
    const rows: ErpRow[] = items.map(item => ({ id: `${detailId}:${item.id}`, detailId,
      cellHrefs: { number: ananasOrderHref(order.id) }, values: { ...common, sku: item.sku, shortName: item.name,
        qty: item.quantity, unitPrice: item.unitPrice, totalGross: item.gross, totalNet: item.net,
        warehouse: shipments.find(s => s.warehouseId === item.warehouseId)?.warehouseName ?? (item.warehouseId ? `Ananas · ${item.warehouseId}` : "Ananas"),
      } }));
    const shipping = items.reduce((sum, item) => sum + item.shipping, 0);
    if (shipping) rows.push({ id: `${detailId}:shipping`, detailId, cellHrefs: { number: ananasOrderHref(order.id) }, values: {
      ...common, sku: "DOSTAVA", shortName: "Ananas dostava", qty: 1, unitPrice: shipping, totalGross: shipping,
      totalNet: items.reduce((sum, item) => sum + item.shippingNet, 0),
    } });
    return rows;
  });
}
