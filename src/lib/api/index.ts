/**
 * Public surface of the Phase 3C server API layer. Components / route handlers
 * import from `@/lib/api` so individual modules can be reorganised without
 * touching call sites.
 */
export * as catalog from "./catalog";
export * as search from "./search";
export * as cart from "./cart";
export * as checkout from "./checkout";
export * as vouchers from "./vouchers";
export * as account from "./account";
export * as addresses from "./addresses";
export * as cards from "./cards";
export * as orders from "./orders";
export * as wishlist from "./wishlist";
export * as reclamations from "./reclamations";
export * as comments from "./comments";
export * as newsletter from "./newsletter";
export * as uploads from "./uploads";
