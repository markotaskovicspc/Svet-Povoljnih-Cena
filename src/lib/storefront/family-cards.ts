import type { Product } from "@/types";

/** Keep the first matching SKU; never replace a filtered offer with another variant. */
export function uniqueFamilyCards(products: Product[], limit = products.length): Product[] {
  const seen = new Set<string>();
  return products.filter(product => {
    const key = product.variantFamily ? `family:${product.variantFamily.id}` : `sku:${product.sku}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
