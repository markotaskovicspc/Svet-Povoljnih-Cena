/**
 * Phase 4G — Google Merchant + Meta Catalog feeds.
 *
 * Public surface:
 *   - `loadFeedProducts(channel)` → DB rows projected into the
 *     channel-agnostic `FeedProduct` shape.
 *   - `buildGoogleMerchantXml(products)` → GMC RSS 2.0 XML string.
 *   - `buildMetaCsv(products)` → Meta Catalog CSV string.
 *   - `listBudgets()` / `upsertBudget()` → admin per-channel budget I/O.
 */

export { getFeedsConfig, __resetFeedsConfig } from "./config";
export type { FeedsConfig } from "./config";
export type { FeedProduct } from "./types";
export { loadFeedProducts } from "./source";
export type { FeedChannel } from "./source";
export { buildGoogleMerchantXml } from "./google";
export { buildMetaCsv } from "./meta";
export { listBudgets, upsertBudget } from "./budget";
export type { BudgetState, AdChannelKey } from "./budget";
