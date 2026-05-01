/**
 * Pricing engine configuration (Phase 3D — item 2).
 *
 * Single source of truth for stackable discounts. These are intentionally
 * exported as plain constants so they can later be hydrated from an
 * `AdminSetting` table without touching call-sites — admin UI in Phase 5
 * will write into this shape.
 */

/** First-purchase discount, applied on the first ever order of a user. */
export const FIRST_PURCHASE_PCT = 5;

/** Discount when paying with a tokenized saved card. */
export const SAVED_CARD_PCT = 5;

/**
 * Maximum combined stack of order-level discounts (voucher + first-purchase
 * + saved-card), expressed as a percentage of the eligible subtotal.
 *
 * Per spec: "discounts not stackable beyond X% (admin)". 30 is the launch
 * default; admin override lands in Phase 5.
 */
export const MAX_STACK_PCT = 30;

/**
 * Items already on action are NOT eligible for additional order-level
 * discounts by default — a frequent retail rule that prevents unbounded
 * stacking with already-marked-down stock. Toggleable per launch needs.
 */
export const EXCLUDE_SALE_FROM_STACK = false;
