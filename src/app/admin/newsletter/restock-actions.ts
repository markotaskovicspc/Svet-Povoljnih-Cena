"use server";
import { withAdminState } from "@/lib/admin";
import { processRestockWaitlist } from "@/lib/email/restock";
import { revalidatePath } from "next/cache";
export async function sendRestockSegmentAction(productId: string) {
  const state = await withAdminState({ allowed: ["ADS"], action: "restock.segment.send", entity: "Product" }, async () => {
    if (!productId || productId.length > 100) throw new Error("Artikal nije ispravan.");
    const result = await processRestockWaitlist(25, productId);
    revalidatePath("/admin/newsletter");
    return { ok: true as const, entityId: productId, diff: result, result };
  })();
  if (!state.ok || !state.result) throw new Error(state.message || "Slanje nije potvrđeno.");
  return state.result;
}
