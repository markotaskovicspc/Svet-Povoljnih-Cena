"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { reopenPurchasingDocument } from "@/lib/admin/purchasing-reopening.server";

const schema = z.object({ kind: z.enum(["invoice", "purchase-order"]), id: z.string().min(1), lockedAt: z.iso.datetime() });

export async function reopenPurchasingAction(_state: AdminActionState, formData: FormData) {
  return withAdminState({ module: ["/admin/erp/porudzbenice", "/admin/erp/ulazne-fakture"], allowed: ["SUPER"], action: "purchasing.reopen", entity: "PurchaseOrder" }, async (actorId, data: FormData) => {
    const parsed = schema.safeParse(Object.fromEntries(data.entries()));
    if (!parsed.success) return { ok: false as const, error: "Dokument nije izabran ili je u međuvremenu promenjen." };
    const result = await reopenPurchasingDocument(parsed.data, actorId);
    revalidatePath(`/admin/erp/porudzbenice/${result.orderId}`);
    revalidatePath("/admin/erp/porudzbenice");
    revalidatePath("/admin/erp/porudzbenice-po-artiklima");
    if (result.invoiceId) revalidatePath(`/admin/erp/ulazne-fakture/${result.invoiceId}`);
    revalidatePath("/admin/erp/ulazne-fakture");
    return { ok: true as const, entityId: result.orderId, diff: result, message: "Dokumenti su ponovo otvoreni za izmenu. Po završetku proknjižite izmene." };
  })(formData);
}
