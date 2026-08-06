import "server-only";

import type { FeedProduct } from "./types";

const HEADERS = [
  "sku_id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "sale_price",
  "link",
  "image_link",
  "additional_image_link",
  "brand",
  "google_product_category",
  "product_type",
  "mpn",
  "item_group_id",
  "color",
] as const;

export function buildTiktokCsv(products: FeedProduct[]) {
  const rows = [HEADERS.join(",")];
  for (const product of products) {
    rows.push([
      csv(product.id),
      csv(product.title),
      csv(product.description),
      csv(product.availability),
      csv(product.condition),
      csv(`${product.price.toFixed(2)} ${product.currency}`),
      csv(product.salePrice == null ? "" : `${product.salePrice.toFixed(2)} ${product.currency}`),
      csv(product.link),
      csv(product.imageLink),
      csv(product.additionalImageLinks.join(",")),
      csv(product.brand),
      csv(product.googleProductCategory ?? ""),
      csv(product.productType ?? ""),
      csv(product.mpn),
      csv(product.itemGroupId ?? ""),
      csv(product.color ?? ""),
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function csv(value: string) {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  return /[",]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}
