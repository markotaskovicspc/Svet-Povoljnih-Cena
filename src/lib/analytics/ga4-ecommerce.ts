import type { Order, PaymentMethod } from "@/types";

export const GA4_CURRENCY = "RSD";
export const GA4_AFFILIATION = "Svet povoljnih cena";

export interface Ga4ItemInput {
  sku: string;
  name: string;
  unitPrice: number;
  quantity?: number;
  fullUnitPrice?: number;
  categories?: string[];
  assemblyUnitPrice?: number;
}

export interface Ga4EcommerceItem {
  item_id: string;
  item_name: string;
  affiliation: string;
  price: number;
  quantity: number;
  discount?: number;
  index?: number;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  google_business_vertical: "retail";
}

export function buildGa4Item(
  input: Ga4ItemInput,
  index = 0,
): Ga4EcommerceItem {
  const quantity = positiveQuantity(input.quantity);
  const assembly = nonNegativeMoney(input.assemblyUnitPrice);
  const price = nonNegativeMoney(input.unitPrice) + assembly;
  const fullPrice =
    Math.max(nonNegativeMoney(input.fullUnitPrice), nonNegativeMoney(input.unitPrice)) +
    assembly;
  const discount = roundMoney(Math.max(0, fullPrice - price));
  const categories = (input.categories ?? [])
    .map((category) => category.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    item_id: input.sku,
    item_name: input.name,
    affiliation: GA4_AFFILIATION,
    price: roundMoney(price),
    quantity,
    ...(discount > 0 ? { discount } : {}),
    index,
    ...(categories[0] ? { item_category: categories[0] } : {}),
    ...(categories[1] ? { item_category2: categories[1] } : {}),
    ...(categories[2] ? { item_category3: categories[2] } : {}),
    ...(categories[3] ? { item_category4: categories[3] } : {}),
    ...(categories[4] ? { item_category5: categories[4] } : {}),
    google_business_vertical: "retail",
  };
}

export function buildViewItemPayload(input: Ga4ItemInput) {
  const item = buildGa4Item(input);
  return {
    currency: GA4_CURRENCY,
    value: itemValue([item]),
    items: [item],
  };
}

export function buildAddToCartPayload(input: Ga4ItemInput) {
  const item = buildGa4Item(input);
  return {
    currency: GA4_CURRENCY,
    value: itemValue([item]),
    items: [item],
  };
}

export function buildBeginCheckoutPayload(
  inputs: Ga4ItemInput[],
  options?: { coupon?: string; discount?: number },
) {
  const items = allocateOrderDiscount(
    inputs.slice(0, 200).map((input, index) => buildGa4Item(input, index)),
    options?.discount,
  );
  return {
    currency: GA4_CURRENCY,
    value: itemValue(items),
    ...(options?.coupon ? { coupon: options.coupon } : {}),
    items,
  };
}

export function buildPurchasePayload(order: Order) {
  const items = allocateOrderDiscount(
    order.items.slice(0, 200).map((item, index) =>
      buildGa4Item(
        {
          sku: item.sku,
          name: item.name,
          unitPrice: item.unitPriceSale,
          fullUnitPrice: item.unitPriceFull,
          quantity: item.qty,
          assemblyUnitPrice: item.withAssembly ? item.assemblyPrice : 0,
        },
        index,
      ),
    ),
    order.voucherDiscount,
  );

  return {
    transaction_id: order.id,
    affiliation: GA4_AFFILIATION,
    currency: GA4_CURRENCY,
    value: itemValue(items),
    shipping: roundMoney(order.shipping),
    ...(order.voucherCode ? { coupon: order.voucherCode } : {}),
    items,
  };
}

export function isPurchaseReady(
  order: Order,
  paymentStatus?: string,
) {
  if (isDeferredPayment(order.paymentMethod)) return true;
  return paymentStatus === "paid" || order.payment?.status === "paid";
}

function isDeferredPayment(method: PaymentMethod) {
  return (
    method === "uplata_na_racun" ||
    method === "pouzece_gotovina" ||
    method === "pouzece_kartica"
  );
}

function allocateOrderDiscount(
  items: Ga4EcommerceItem[],
  requestedDiscount: number | null | undefined,
) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const discount = Math.min(nonNegativeMoney(requestedDiscount), subtotal);
  if (discount <= 0 || subtotal <= 0) return items;

  let allocated = 0;
  return items.map((item, index) => {
    const lineTotal = item.price * item.quantity;
    const lineDiscount =
      index === items.length - 1
        ? discount - allocated
        : roundMoney((discount * lineTotal) / subtotal);
    allocated += lineDiscount;
    const discountPerUnit = lineDiscount / item.quantity;
    return {
      ...item,
      price: roundMoney(Math.max(0, item.price - discountPerUnit), 4),
      discount: roundMoney((item.discount ?? 0) + discountPerUnit, 4),
    };
  });
}

function itemValue(items: Ga4EcommerceItem[]) {
  return roundMoney(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
}

function positiveQuantity(value: number | null | undefined) {
  const quantity = Number.isFinite(value) ? Math.floor(Number(value)) : 1;
  return Math.max(1, quantity);
}

function nonNegativeMoney(value: number | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function roundMoney(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
