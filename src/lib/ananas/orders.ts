import { z } from "zod";

const id = z.union([z.string().min(1).max(100), z.number().finite()]).transform(String);
const money = z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().finite().nonnegative().max(999999999999));
const quantity = z.number().int().nonnegative();
const optionalText = z.string().max(1000).nullish();
const apiItem = z.object({
  id, productSku: optionalText, productEan: optionalText, productName: optionalText,
  quantity, confirmedQuantity: quantity.nullish(), packedQuantity: quantity.nullish(),
  basePrice: money, grandTotal: money, grandTotalWithoutVat: money,
  vat: money, shippingCost: money.nullish(), shippingCostWithoutVat: money.nullish(),
  takeRateTotal: money.nullish(), suborderWarehouseAddressId: id.nullish(),
});
const billing = z.object({ firstName: optionalText, lastName: optionalText, buyerName: optionalText,
  buyerId: optionalText, buyerType: optionalText, city: optionalText, postcode: optionalText,
  streetName: optionalText, streetNumber: optionalText,
});
const apiOrder = z.object({ id, createdDate: z.string(), totalPrice: money, currency: z.literal("RSD"),
  paymentMethods: z.array(z.string()).optional(), paymentMethod: z.array(z.string()).optional(),
  billingAddress: billing.nullish(), items: z.array(apiItem).min(1).max(1000),
});
export function normalizeAnanasOrder(value: unknown) {
  const row = apiOrder.parse(value);
  const createdAt = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(row.createdDate) ? row.createdDate : `${row.createdDate}Z`);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Ananas datum porudžbine nije ispravan.");
  if (new Set(row.items.map(item => item.id)).size !== row.items.length) throw new Error("Ananas porudžbina sadrži duplirane stavke.");
  const address = row.billingAddress ?? {};
  return { id: row.id, createdAt, total: row.totalPrice, currency: row.currency,
    paymentMethods: (row.paymentMethods ?? row.paymentMethod ?? []).join(", "),
    customerName: address.buyerName || [address.firstName, address.lastName].filter(Boolean).join(" ") || null,
    billingAddress: JSON.parse(JSON.stringify(address)) as Record<string, string | null>,
    items: row.items.map(item => ({ id: item.id, sku: item.productSku ?? "", ean: item.productEan ?? "", name: item.productName ?? item.productSku ?? "Artikal",
      quantity: item.quantity, confirmed: item.confirmedQuantity ?? null, packed: item.packedQuantity ?? null,
      unitPrice: item.basePrice, gross: item.grandTotal, net: item.grandTotalWithoutVat, vat: item.vat,
      shipping: item.shippingCost ?? 0, shippingNet: item.shippingCostWithoutVat ?? 0, commission: item.takeRateTotal ?? null,
      warehouseId: item.suborderWarehouseAddressId ?? null,
    })),
  };
}
export type AnanasOrderItem = ReturnType<typeof normalizeAnanasOrder>["items"][number];
const shipment = z.object({ orderId: id, suborderId: id, status: z.string().min(1),
  warehouseId: id.nullish(), warehouseName: optionalText, carrierName: optionalText,
  items: z.array(z.object({ orderedQuantity: quantity, productSku: optionalText, productEan: optionalText })),
});
export function normalizeAnanasShipments(values: unknown[]) {
  return values.map(value => {
    const s = shipment.parse(value);
    return { orderId: s.orderId, suborderId: s.suborderId, status: s.status,
      warehouseId: s.warehouseId ?? null, warehouseName: s.warehouseName ?? null, carrierName: s.carrierName ?? null,
      quantity: s.items.reduce((sum, item) => sum + item.orderedQuantity, 0) };
  });
}
export type AnanasOrderShipment = ReturnType<typeof normalizeAnanasShipments>[number];
const delivered = new Set(["DELIVERED", "COMPLETED_PUDO", "COMPLETED_LOCKER"]);
const cancelled = new Set(["CANCELLED", "CANCELLED_BY_JOB", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_MERCHANT", "CANCELLED_BY_EMPLOYEE", "TERMINATED", "MISSING_ITEMS"]);
const terminal = new Set([...delivered, ...cancelled, "RETURNED_TO_SELLER"]);
export function ananasOrderStatus(shipments: AnanasOrderShipment[], orderedQuantity: number) {
  const complete = shipments.length > 0 && shipments.reduce((sum, row) => sum + row.quantity, 0) >= orderedQuantity;
  const statuses = shipments.map(s => s.status);
  const closed = complete && statuses.every(s => terminal.has(s));
  const status = !statuses.length ? "Čeka proveru"
    : complete && statuses.every(s => delivered.has(s)) ? "Isporučeno"
    : complete && statuses.every(s => cancelled.has(s)) ? "Otkazano"
    : complete && statuses.every(s => s === "RETURNED_TO_SELLER") ? "Vraćeno"
    : closed ? "Završeno — mešovito"
    : statuses.some(s => /RETURN|LOST|DAMAGED|REJECTED|INVALID/.test(s)) ? "Problem / povrat"
    : statuses.some(s => /DELIVERY|COLLECTED/.test(s)) ? "Na isporuci"
    : "U obradi";
  return { status, needsRefresh: !closed };
}
