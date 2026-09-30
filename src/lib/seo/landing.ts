import type { LandingPageSnapshot } from "@/lib/landing-pages/blocks";

export function landingIsIndexable(snapshot: Pick<LandingPageSnapshot, "robotsIndex" | "template" | "productSkus">, publicSkus?: Set<string>) {
  if (!snapshot.robotsIndex) return false;
  if (snapshot.template !== "SIMPLE_PRODUCT_LIST") return true;
  return snapshot.productSkus.some(sku => !publicSkus || publicSkus.has(sku));
}
