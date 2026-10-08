import "server-only";
import { listProducts } from "@/lib/api/catalog";
import { standardPromoPage } from "@/lib/storefront/promo-product-order";

export async function getStandardPromoSkus(key: string, automatic = false) {
  const page = standardPromoPage(key);
  if (!page) throw new Error("Nepostojeća promo strana.");
  const skus: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await listProducts({ ...page.query, ignorePromoOrder: automatic, cursor, limit: 300, includeTotal: false });
    skus.push(...result.items.map(product => product.sku));
    cursor = result.nextCursor ?? undefined;
    if (skus.length > 3000 || (skus.length === 3000 && cursor)) {
      throw new Error("Ponuda ima više od 3.000 artikala i zahteva proširen editor redosleda.");
    }
  } while (cursor);
  return skus;
}
