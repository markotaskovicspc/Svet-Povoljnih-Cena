import { AdminActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { reopenPurchasingAction } from "@/app/admin/erp/purchasing-actions";

export function PurchasingReopenForm({ kind, id, lockedAt }: { kind: "invoice" | "purchase-order"; id: string; lockedAt: Date }) {
  return <AdminActionForm action={reopenPurchasingAction} refreshOnSuccess>
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="lockedAt" value={lockedAt.toISOString()} />
    <SubmitButton variant="outline" pendingLabel="Otvaranje…" confirm="Ponovo otvoriti dokument i povezanu prijemnicu/porudžbenicu za izmenu? Postojeći lager ostaje sačuvan. Po završetku je obavezno ponovno knjiženje izmena.">
      Ponovo otvori za izmenu
    </SubmitButton>
  </AdminActionForm>;
}
