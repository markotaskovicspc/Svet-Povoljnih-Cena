"use server";

import { revalidatePath } from "next/cache";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { createArticlePurchasePrice } from "@/lib/admin/article-purchase-price.server";

export async function addArticlePurchasePrice(
  productId: string,
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState({ module: "/admin/erp/nabavne-cene",
    allowed: allowedRolesForErpModule("nabavne-cene"),
    action: "article.purchase-price.create",
    entity: "PurchasePrice",
  }, async (_actorId, form: FormData) => {
    const price = await createArticlePurchasePrice(productId, form);
    revalidatePath(`/admin/erp/artikli/${encodeURIComponent(productId)}`);
    revalidatePath("/admin/erp/nabavne-cene");
    return {
      ok: true as const,
      entityId: price.id,
      message: "Nabavna cena je sačuvana.",
      diff: {
        productId: price.productId, sku: price.sku, price: price.price.toString(),
        currency: price.currency, parity: price.parity,
        validFrom: price.validFrom.toISOString(), validTo: price.validTo?.toISOString() ?? null,
      },
    };
  })(formData);
}
