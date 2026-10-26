import "server-only";

import { db } from "@/lib/db";
import { createPurchasePrice } from "./purchase-price.server";

/** Resolve identity again at submission; form fields cannot redirect the price to another SKU. */
export async function createArticlePurchasePrice(productId: string, form: FormData) {
  if (typeof productId !== "string" || !productId || productId.length > 200) {
    throw new Error("Artikal nije izabran.");
  }
  const product = await db.product.findUnique({
    where: { id: productId, deletedAt: null },
    select: { id: true, sku: true },
  });
  if (!product) throw new Error("Artikal više nije dostupan. Osvežite karticu artikla.");

  return createPurchasePrice({
    sku: product.sku,
    purchasePrice: form.get("purchasePrice"),
    validFrom: form.get("validFrom"),
    validTo: form.get("validTo"),
  });
}
