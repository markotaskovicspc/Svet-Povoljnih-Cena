/**
 * Pricing engine configuration (Phase 3D — item 2).
 *
 * Shared stacking rules and the time-dependent first-purchase rate.
 */

/** Evaluate at checkout time, never freeze the scheduled rate at module load. */
export { firstPurchaseDiscountPct } from "@/lib/commerce-terms";

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
