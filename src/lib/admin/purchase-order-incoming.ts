/** Shared by the warehouse grid and article card; dates describe planned PO deliveries. */
export const INCOMING_PURCHASE_ORDER_WHERE = {
  status: { not: "CANCELLED" as const },
};

export type IncomingPurchaseOrderLine = {
  productId: string;
  warehouseId: string | null;
  warehouseActive?: boolean;
  qty: number;
  receivedQty: number;
  deliveryDate?: Date | null;
  status?: string;
};

export type PurchaseOrderIncomingSummary = {
  productId: string;
  warehouseId: string;
  incoming: number;
  firstIncomingDate: string | null;
  firstIncomingQty: number | null;
};

export function incomingWarehouseKey(productId: string, warehouseId: string) {
  return `${productId}:${warehouseId}`;
}

export function summarizePurchaseOrderIncoming(input: {
  lines: readonly IncomingPurchaseOrderLine[];
  storedIncoming: readonly { productId: string; incomingStock: number }[];
  defaultWarehouseId: string | null;
}) {
  const summaries = new Map<string, PurchaseOrderIncomingSummary>();
  const derivedByProduct = new Map<string, number>();
  const balance = (productId: string, warehouseId: string) => {
    const key = incomingWarehouseKey(productId, warehouseId);
    let summary = summaries.get(key);
    if (!summary) {
      summary = { productId, warehouseId, incoming: 0, firstIncomingDate: null, firstIncomingQty: null };
      summaries.set(key, summary);
    }
    return summary;
  };

  for (const line of input.lines) {
    if (line.status === "CANCELLED") continue;
    const remaining = Math.max(line.qty - line.receivedQty, 0);
    if (remaining === 0) continue;
    derivedByProduct.set(line.productId, (derivedByProduct.get(line.productId) ?? 0) + remaining);
    const warehouseId = line.warehouseActive === false
      ? input.defaultWarehouseId
      : line.warehouseId ?? input.defaultWarehouseId;
    if (!warehouseId) continue;
    const summary = balance(line.productId, warehouseId);
    summary.incoming += remaining;
    // PO dates are calendar dates stored at UTC midnight, not event timestamps.
    const date = line.deliveryDate && Number.isFinite(line.deliveryDate.getTime())
      ? line.deliveryDate.toISOString().slice(0, 10)
      : null;
    if (date && (!summary.firstIncomingDate || date < summary.firstIncomingDate)) {
      summary.firstIncomingDate = date;
      summary.firstIncomingQty = remaining;
    } else if (date && date === summary.firstIncomingDate) {
      summary.firstIncomingQty = (summary.firstIncomingQty ?? 0) + remaining;
    }
  }

  // A legacy quantity has no trustworthy delivery date. Preserve only the part
  // not already explained by POs across all destination warehouses, once in DC.
  if (input.defaultWarehouseId) {
    for (const product of input.storedIncoming) {
      const extra = Math.max(product.incomingStock - (derivedByProduct.get(product.productId) ?? 0), 0);
      if (extra > 0) balance(product.productId, input.defaultWarehouseId).incoming += extra;
    }
  }
  return summaries;
}

/** Article cards use the same calculation but display only their default DC destination. */
export function summarizeArticleIncoming(product: {
  id: string;
  incomingStock: number;
  purchaseOrderItems: readonly {
    qty: number;
    receivedQty: number;
    purchaseOrder: {
      status: string;
      deliveryDate: Date | null;
      receivingWarehouse: { id: string; active: boolean } | null;
    };
  }[];
}, defaultWarehouseId: string | null) {
  const summaries = summarizePurchaseOrderIncoming({
    lines: product.purchaseOrderItems.map(item => ({
      productId: product.id, qty: item.qty, receivedQty: item.receivedQty,
      deliveryDate: item.purchaseOrder.deliveryDate, status: item.purchaseOrder.status,
      warehouseId: item.purchaseOrder.receivingWarehouse?.id ?? null,
      warehouseActive: item.purchaseOrder.receivingWarehouse?.active,
    })),
    storedIncoming: [{ productId: product.id, incomingStock: product.incomingStock }],
    defaultWarehouseId,
  });
  return defaultWarehouseId ? summaries.get(incomingWarehouseKey(product.id, defaultWarehouseId)) ?? null : null;
}
