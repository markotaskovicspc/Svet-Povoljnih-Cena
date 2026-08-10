/**
 * Pricing engine configuration (Phase 3D — item 2).
 *
 * Single source of truth for stackable discounts. These are intentionally
 * exported as plain constants so they can later be hydrated from an
 * `AdminSetting` table without touching call-sites — admin UI in Phase 5
 * will write into this shape.
 */

/** First-purchase discount, consumed when the first sale receipt is fiscalized. */
export const FIRST_PURCHASE_PCT = 15;

/** Discount when paying with a tokenized saved card. */
export const SAVED_CARD_PCT = 5;

/**
 * There is no commercial stacking cap. 100 only protects the order total
 * from becoming negative if several discounts cover the whole subtotal.
 */
export const MAX_STACK_PCT = 100;

/**
 * Items already on action are NOT eligible for additional order-level
 * discounts by default — a frequent retail rule that prevents unbounded
 * stacking with already-marked-down stock. Toggleable per launch needs.
 */
export const EXCLUDE_SALE_FROM_STACK = false;
