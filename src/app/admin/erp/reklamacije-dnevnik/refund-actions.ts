"use server";

import { after } from "next/server";
import { db } from "@/lib/db";
import { queueReclamationRefundNotice } from "@/lib/admin/reclamation-refund-notice.server";
import { processBackgroundJob } from "@/lib/background-jobs";
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
  return withAdminState({ module: "/admin/erp/reklamacije-dnevnik", allowed: ["OPS"], action: "reclamation.fiscalRefund", entity: "Reclamation" }, async (actorId, form: FormData) => {
    const id = String(form.get("id") ?? "");
    try {
      const result = await issueReclamationRefund({ id, actorId });
      const noticeJobId = await db.$transaction(tx => queueReclamationRefundNotice(tx, id));
      if (noticeJobId) after(() => processBackgroundJob(noticeJobId));
      return { ok: true as const, entityId: id, diff: { payoutId: result.payoutId }, message: "Fiskalna refundacija je spremna. Podrška dobija mejl za proveru da li je novac već vraćen. Izvršenu uplatu možete evidentirati ispod." };
    } finally { refresh(id); }
  })(data);
}

export async function confirmClaimPayoutAction(_state: AdminActionState, data: FormData) {
  return withAdminState({ module: "/admin/erp/reklamacije-dnevnik", allowed: ["OPS"], action: "reclamation.payoutConfirmed", entity: "Reclamation" }, async (actorId, form: FormData) => {
    const id = String(form.get("id") ?? "");
    try {
      const payoutId = await confirmReclamationPayout({ id, actorId, paidAt: String(form.get("paidAt") ?? ""), reference: String(form.get("reference") ?? ""), confirmed: form.get("confirmed") === "on" });
      return { ok: true as const, entityId: id, diff: { payoutId }, message: "Ručna isplata je evidentirana i reklamacija je rešena." };
    } finally { refresh(id); }
  })(data);
}

/** Marko, 13.11.2026: ručno odobrenje uplate povrata iako roba nije vraćena (SPC Analytics tada pravi QR). */
export async function approveRefundWithoutReturnAction(_state: AdminActionState, data: FormData) {
  return withAdminState({ module: "/admin/erp/reklamacije-dnevnik", allowed: ["OPS"], action: "reclamation.refundWithoutReturn", entity: "Reclamation" }, async (actorId, form: FormData) => {
    const id = String(form.get("id") ?? "");
    try {
      const updated = await db.reclamation.updateMany({
        where: { id, decision: "PRIHVACENA", resolution: "POVRAT_NOVCA", status: { notIn: ["ODBIJENO", "RESENO"] }, refundWithoutReturnAt: null },
        data: { refundWithoutReturnAt: new Date(), refundWithoutReturnById: actorId },
      });
      if (!updated.count) return { ok: false as const, error: "Uplata se može odobriti samo za prihvaćen povrat novca koji još nije rešen." };
      return { ok: true as const, entityId: id, diff: { refundWithoutReturn: true }, message: "Uplata je odobrena bez vraćene robe. SPC Analytics u narednih 10 minuta priprema QR. Fiskalnu refundaciju ERP i dalje radi tek po prijemu robe." };
    } finally { refresh(id); }
  })(data);
}

