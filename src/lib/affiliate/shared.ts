export const AFFILIATE_COOKIE = "spc_affiliate";
export const AFFILIATE_WINDOW_SECONDS = 30 * 24 * 60 * 60;
export function normalizeAffiliateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,39}$/.test(code) ? code : null;
}
export function affiliateOrderBucket(status: string) {
  if (status === "ISPORUCENO") return "delivered";
  if (status === "OTKAZANO" || status === "VRACENO") return "excluded";
  return "pending";
}
