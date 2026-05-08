import "server-only";

import type { FeedProduct } from "./types";
import { getFeedsConfig } from "./config";

/**
 * Build a Google Merchant Center XML feed (RSS 2.0 with the
 * `g:` namespace), per the spec at:
 *   https://support.google.com/merchants/answer/7052112
 *
 * v1 emits only the required + commonly-recommended fields. Variants
 * and item-group_id are deferred to Phase 5.
 */
export function buildGoogleMerchantXml(products: FeedProduct[]): string {
  const cfg = getFeedsConfig();
  const now = new Date().toUTCString();
  const items = products.map(renderItem).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>${escapeXml(cfg.shopTitle)}</title>
    <link>${escapeXml(cfg.baseUrl)}</link>
    <description>${escapeXml(cfg.shopDescription)}</description>
    <lastBuildDate>${now}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function renderItem(p: FeedProduct): string {
  const cfg = getFeedsConfig();
  const lines: string[] = [
    `      <g:id>${escapeXml(p.id)}</g:id>`,
    `      <g:title>${escapeXml(p.title)}</g:title>`,
    `      <g:description>${escapeXml(p.description)}</g:description>`,
    `      <g:link>${escapeXml(p.link)}</g:link>`,
    `      <g:image_link>${escapeXml(p.imageLink)}</g:image_link>`,
    ...p.additionalImageLinks.map(
      (u) => `      <g:additional_image_link>${escapeXml(u)}</g:additional_image_link>`,
    ),
    `      <g:availability>${escapeXml(p.availability)}</g:availability>`,
    `      <g:price>${p.price.toFixed(2)} ${escapeXml(p.currency)}</g:price>`,
  ];
  if (p.salePrice != null) {
    lines.push(`      <g:sale_price>${p.salePrice.toFixed(2)} ${escapeXml(p.currency)}</g:sale_price>`);
  }
  lines.push(
    `      <g:brand>${escapeXml(p.brand)}</g:brand>`,
    `      <g:condition>${escapeXml(p.condition)}</g:condition>`,
    `      <g:mpn>${escapeXml(p.mpn)}</g:mpn>`,
    `      <g:identifier_exists>false</g:identifier_exists>`,
    `      <g:content_language>${escapeXml(cfg.contentLanguage)}</g:content_language>`,
    `      <g:target_country>${escapeXml(cfg.targetCountry)}</g:target_country>`,
  );
  if (p.googleProductCategory) {
    lines.push(
      `      <g:google_product_category>${escapeXml(p.googleProductCategory)}</g:google_product_category>`,
    );
  }
  if (p.productType) {
    lines.push(`      <g:product_type>${escapeXml(p.productType)}</g:product_type>`);
  }
  return `    <item>\n${lines.join("\n")}\n    </item>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip control chars that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
