import "server-only";
import { listProducts, listProductFacets, type ListProductsInput } from "@/lib/api/catalog";
import { searchProductSkus } from "@/lib/api/search";

export async function listSearchProducts(query: string, input: ListProductsInput = {}) {
  const searchSkus = await searchProductSkus(query);
  return listProducts({ ...input, searchSkus, ignorePromoOrder: true });
}

export async function listSearchProductFacets(query: string, input: ListProductsInput = {}) {
  const searchSkus = await searchProductSkus(query);
  return listProductFacets({ ...input, searchSkus });
}
