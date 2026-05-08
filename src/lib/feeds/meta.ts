import "server-only";

import type { FeedProduct } from "./types";

/**
 * Build a Meta (Facebook/Instagram) Catalog CSV feed, per spec:
 *   https://www.facebook.com/business/help/120325381656392
 *
 * Column order matches Meta's documented header so the file can be
 * uploaded directly via Commerce Manager → Data Feeds.
 */

const HEADERS = [
  "id",
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
] as const;

export function buildMetaCsv(products: FeedProduct[]): string {
  const rows = [HEADERS.join(",")];
  for (const p of products) {
    rows.push(
      [
        csv(p.id),
        csv(p.title),
        csv(p.description),
        csv(p.availability),
        csv(p.condition),
        csv(`${p.price.toFixed(2)} ${p.currency}`),
        csv(p.salePrice != null ? `${p.salePrice.toFixed(2)} ${p.currency}` : ""),
        csv(p.link),
        csv(p.imageLink),
        csv(p.additionalImageLinks.join(",")),
        csv(p.brand),
        csv(p.googleProductCategory ?? ""),
        csv(p.productType ?? ""),
        csv(p.mpn),
        csv(p.id),
      ].join(","),
    );
  }
  // Trailing newline keeps Excel/Sheets happy.
  return rows.join("\n") + "\n";
}

function csv(value: string): string {
  const v = value.replace(/\r?\n/g, " ").trim();
  if (/[",]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
