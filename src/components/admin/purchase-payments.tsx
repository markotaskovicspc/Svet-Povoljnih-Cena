import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { recordPurchasePayment, summarizePurchasePayments, voidPurchasePayment } from "@/lib/admin/purchase-payments.server";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit";

async function add(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState({ allowed: ["OPS"], action: "po.payment.record", entity: "PurchaseOrderPayment" },
    async (actorId, form: FormData) => {
      const payment = await recordPurchasePayment(Object.fromEntries(form.entries()), actorId);
      revalidatePath("/admin/erp/porudzbenice/" + payment.purchaseOrderId);
      return { ok: true as const, entityId: payment.id,
        diff: { purchaseOrderId: payment.purchaseOrderId, amount: payment.amount.toFixed(2),
          amountRsd: payment.amountRsd.toFixed(2), currency: payment.currency, paidAt: payment.paidAt.toISOString() },
        message: "Uplata je evidentirana." };
    })(formData);
}

async function voidPayment(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState({ allowed: ["OPS"], action: "po.payment.void", entity: "PurchaseOrderPayment" },
    async (_actorId, form: FormData) => {
      const purchaseOrderId = String(form.get("purchaseOrderId") ?? "");
      const paymentId = String(form.get("paymentId") ?? "");
      if (!purchaseOrderId || !paymentId) throw new Error("Uplata nije izabrana.");
      const result = await voidPurchasePayment(purchaseOrderId, paymentId);
      revalidatePath("/admin/erp/porudzbenice/" + purchaseOrderId);
      return { ok: true as const, entityId: paymentId,
        diff: { purchaseOrderId, voided: result.count }, message: "Uplata je stornirana." };
    })(formData);
}

const format = (value: string) => Number(value).toLocaleString("sr-Latn-RS", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export async function PurchasePayments({ purchaseOrderId }: { purchaseOrderId: string }) {
  const order = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { payments: { orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] } },
  });
  const totals = summarizePurchasePayments(order.payments);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <Card id="uplate">
    <CardTitle description="Evidentirajte stvarno izvršene uplate. Pogrešnu uplatu stornirajte i unesite novu.">Uplate</CardTitle>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th className="p-2">Datum</th><th className="p-2">Iznos</th><th className="p-2">Iznos RSD</th><th className="p-2">Napomena</th><th className="p-2">Status</th></tr></thead>
        <tbody>{order.payments.map((payment) => <tr key={payment.id} className={"border-b " + (payment.voidedAt ? "opacity-50" : "")}>
          <td className="p-2">{payment.paidAt.toISOString().slice(0, 10)}</td>
          <td className="p-2 tabular-nums">{format(payment.amount.toFixed(2))} {payment.currency}</td>
          <td className="p-2 tabular-nums">{format(payment.amountRsd.toFixed(2))}</td>
          <td className="p-2">{payment.notes ?? "—"}</td>
          <td className="p-2">{payment.voidedAt ? "Storno" :
            <AdminActionForm action={voidPayment}>
              <input type="hidden" name="purchaseOrderId" value={order.id} />
              <input type="hidden" name="paymentId" value={payment.id} />
              <ConfirmSubmitButton confirm="Stornirati ovu uplatu?" size="xs">Storniraj</ConfirmSubmitButton>
            </AdminActionForm>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="my-4 font-medium">Ukupno plaćeno: {format(totals.totalAmount)} {order.currency} · {format(totals.totalRsd)} RSD</p>
    {order.status !== "CANCELLED" ? <AdminActionForm action={add} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={randomUUID()} />
      <input type="hidden" name="purchaseOrderId" value={order.id} />
      <Field label="Datum uplate"><Input name="paidAt" type="date" required defaultValue={today} /></Field>
      <Field label={"Iznos " + order.currency}><Input name="amount" type="number" required min="0.01" max="9999999999.99" step="0.01" /></Field>
      {order.currency === "RSD" ? <input type="hidden" name="amountRsd" value="1" /> :
        <Field label="Stvarno plaćeno RSD"><Input name="amountRsd" type="number" required min="0.01" max="9999999999.99" step="0.01" /></Field>}
      <Field label="Napomena"><Input name="notes" maxLength={2000} /></Field>
      <SubmitButton>Dodaj uplatu</SubmitButton>
    </AdminActionForm> : null}
  </Card>;
}
