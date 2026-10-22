"use server";

import { revalidatePath } from "next/cache";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { issueReclamationRefund, confirmReclamationPayout } from "@/lib/admin/reclamation-refund.server";

function refresh(id: string) {
  revalidatePath(`/admin/erp/reklamacije-dnevnik/${id}`);
  revalidatePath("/admin/erp/reklamacije-dnevnik");
  revalidatePath("/admin/fiskalizacija");
  revalidatePath("/admin/erp/povrati");
}

export async function issueClaimRefundAction(_state: AdminActionState, data: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "reclamation.fiscalRefund", entity: "Reclamation" }, async (actorId, form: FormData) => {
    const id = String(form.get("id") ?? "");
    try {
      const result = await issueReclamationRefund({ id, actorId, bankAccount: String(form.get("bankAccount") ?? ""), confirmPaid: form.get("confirmPaid") === "on" });
      return { ok: true as const, entityId: id, diff: { payoutId: result.payoutId }, message: "Fiskalna refundacija je spremna. Posle ručne uplate na račun kupca potvrdite isplatu ispod." };
    } finally { refresh(id); }
  })(data);
}

export async function confirmClaimPayoutAction(_state: AdminActionState, data: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "reclamation.payoutConfirmed", entity: "Reclamation" }, async (actorId, form: FormData) => {
    const id = String(form.get("id") ?? "");
    try {
      const payoutId = await confirmReclamationPayout({ id, actorId, paidAt: String(form.get("paidAt") ?? ""), reference: String(form.get("reference") ?? ""), confirmed: form.get("confirmed") === "on" });
      return { ok: true as const, entityId: id, diff: { payoutId }, message: "Ručna isplata je evidentirana i reklamacija je rešena." };
    } finally { refresh(id); }
  })(data);
}
