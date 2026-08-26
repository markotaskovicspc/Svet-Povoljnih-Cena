import type { Order } from "@/types";
import {
  buildAddToCartPayload,
  buildBeginCheckoutPayload,
  buildPurchasePayload,
  buildViewItemPayload,
  type Ga4EcommerceItem,
  type Ga4ItemInput,
} from "@/lib/analytics/ga4-ecommerce";

export const META_CURRENCY = "RSD";

export type MetaStandardEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase";

export type MetaCustomData = {
  currency?: typeof META_CURRENCY;
  value?: number;
  content_ids?: string[];
  content_type?: "product";
  contents?: Array<{
    id: string;
    quantity: number;
    item_price: number;
  }>;
  content_name?: string;
  content_category?: string;
  num_items?: number;
  order_id?: string;
};

export function getMetaPixelId(
  configuredId = process.env.NEXT_PUBLIC_META_PIXEL_ID,
) {
  const value = configuredId?.trim();
  return value && /^\d{5,30}$/.test(value) ? value : null;
}

export function buildMetaViewContentPayload(input: Ga4ItemInput): MetaCustomData {
  const ga4 = buildViewItemPayload(input);
  return {
    ...commerceFields(ga4.items, ga4.value),
    content_name: input.name,
    ...(input.categories?.length
      ? { content_category: input.categories.filter(Boolean).join(" > ") }
      : {}),
  };
}

export function buildMetaAddToCartPayload(input: Ga4ItemInput): MetaCustomData {
  const ga4 = buildAddToCartPayload(input);
  return commerceFields(ga4.items, ga4.value);
}

export function buildMetaInitiateCheckoutPayload(
  inputs: Ga4ItemInput[],
  options?: { coupon?: string; discount?: number },
): MetaCustomData {
  const ga4 = buildBeginCheckoutPayload(inputs, options);
  return {
    ...commerceFields(ga4.items, ga4.value),
    num_items: ga4.items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export function buildMetaPurchasePayload(order: Order): MetaCustomData {
  const ga4 = buildPurchasePayload(order);
  return {
    ...commerceFields(ga4.items, ga4.value),
    num_items: ga4.items.reduce((sum, item) => sum + item.quantity, 0),
    order_id: order.id,
  };
}

export function metaPurchaseEventId(orderNumber: string) {
  return `purchase:${orderNumber}`;
}

function commerceFields(
  items: Ga4EcommerceItem[],
  value: number,
): MetaCustomData {
  return {
    currency: META_CURRENCY,
    value,
    content_ids: items.map((item) => item.item_id),
    content_type: "product",
    contents: items.map((item) => ({
      id: item.item_id,
      quantity: item.quantity,
      item_price: item.price,
    })),
  };
}
