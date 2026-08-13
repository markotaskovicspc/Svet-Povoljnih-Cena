import { RABALUX_PUBLIC_STOCK_THRESHOLD } from "./availability";
import type { RabaluxCatalogItem, RabaluxStockItem } from "./types";

export const RABALUX_SERBIA_STOCK_FEED_URL =
  "https://rabalux.rs/downloadmanager/downloadha/nohtml/1/id/11";

export function assertRabaluxSerbiaStockSource(source: {
  country: string | null;
  stockFeedUrl: string | null;
}) {
  if (source.country?.trim().toUpperCase() !== "RS") {
    throw new Error("Rabalux supplier must be configured for Serbia (RS).");
  }
  if (!source.stockFeedUrl) {
    throw new Error("Rabalux Serbia stock feed URL is missing.");
  }

  let configured: URL;
  let expected: URL;
  try {
    configured = new URL(source.stockFeedUrl);
    expected = new URL(RABALUX_SERBIA_STOCK_FEED_URL);
  } catch {
    throw new Error("Rabalux Serbia stock feed URL is invalid.");
  }
  if (
    configured.protocol !== "https:" ||
    configured.username ||
    configured.password ||
    configured.hostname.toLowerCase() !== expected.hostname ||
    configured.port ||
    configured.pathname.replace(/\/+$/, "") !== expected.pathname ||
    configured.search ||
    configured.hash
  ) {
    throw new Error(
      `Rabalux stock import is restricted to the Serbia feed ${RABALUX_SERBIA_STOCK_FEED_URL}.`,
    );
  }
}

export function isRabaluxSerbiaWebStockAvailable(item: RabaluxStockItem) {
  return !item.restricted && item.stock >= RABALUX_PUBLIC_STOCK_THRESHOLD;
}

export function isRabaluxSerbiaStockPresent(item: RabaluxStockItem) {
  return !item.restricted && item.stock > 0;
}

export function rabaluxStockItemsBySku(stock: RabaluxStockItem[]) {
  const stockBySku = new Map<string, RabaluxStockItem>();
  for (const item of stock) {
    if (stockBySku.has(item.sourceSku)) {
      throw new Error(
        `Rabalux Serbia stock feed contains duplicate SKU ${item.sourceSku}; refusing to combine warehouse rows.`,
      );
    }
    stockBySku.set(item.sourceSku, item);
  }
  return stockBySku;
}

export function selectRabaluxSerbiaStockCatalog(
  catalog: RabaluxCatalogItem[],
  stock: RabaluxStockItem[],
) {
  const stockBySku = rabaluxStockItemsBySku(stock);

  const items: RabaluxCatalogItem[] = [];
  const eligibleStockSkus: string[] = [];
  let excludedMissingStock = 0;
  let excludedWithoutStock = 0;
  let excludedRestricted = 0;

  for (const item of catalog) {
    const stockItem = stockBySku.get(item.sourceSku);
    if (!stockItem) {
      excludedMissingStock++;
    } else if (stockItem.restricted) {
      excludedRestricted++;
    } else if (!isRabaluxSerbiaStockPresent(stockItem)) {
      excludedWithoutStock++;
    } else {
      items.push(item);
      eligibleStockSkus.push(item.sourceSku);
    }
  }

  return {
    items,
    stockBySku,
    eligibleStockSkus: eligibleStockSkus.sort(),
    rawCatalogRows: catalog.length,
    stockRows: stock.length,
    excludedMissingStock,
    excludedWithoutStock,
    excludedRestricted,
    excludedBySerbiaStockPolicy:
      excludedMissingStock + excludedWithoutStock + excludedRestricted,
  };
}
