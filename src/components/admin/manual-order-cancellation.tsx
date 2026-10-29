import { revalidatePath } from "next/cache";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { cancelManualSalesOrder } from "@/lib/orders/manual-cancellation.server";
import { AdminActionForm } from "./action-form";
import { SubmitButton } from "./submit-button";

export async function cancelManualOrderAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { module: "/admin/erp/prodajni-nalozi", allowed: ["OPS"], action: "order.manualCancel", entity: "Order" },
    async (actorId, data: FormData) => {
      const order = await cancelManualSalesOrder(String(data.get("id") ?? ""), actorId);
      revalidatePath(`/admin/erp/prodajni-nalozi/${order.id}`);
      revalidatePath("/admin/erp/prodajni-nalozi");
      revalidatePath("/admin/erp/artikli/[id]/zalihe", "page");
      revalidatePath("/admin/erp/artikli/[id]", "page");
      return {
        ok: true as const, entityId: order.id,
        diff: { number: order.number, status: "OTKAZANO", alreadyCancelled: order.alreadyCancelled },
        message: "Porudžbina je otkazana. Rezervacije svih artikala su oslobođene.",
      };
    },
  )(formData);
}

export function ManualOrderCancellation({ id, number }: { id: string; number: string }) {
  return (
    <AdminActionForm action={cancelManualOrderAction} refreshOnSuccess testId="manual-order-cancel-form" className="max-w-md">
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="destructive" pendingLabel="Otkazivanje…"
        confirm={`Otkazati celu porudžbinu ${number}? Rezervacije svih artikala biće oslobođene. Nalog i istorija ostaju sačuvani.`}>
        Otkaži porudžbinu
      </SubmitButton>
    </AdminActionForm>
  );
}
