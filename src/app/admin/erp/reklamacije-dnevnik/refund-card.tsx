import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { loadReclamationRefund } from "@/lib/admin/reclamation-refund.server";
import { issueClaimRefundAction, confirmClaimPayoutAction } from "./refund-actions";

const inputClass = "h-10 rounded-lg border border-input bg-transparent px-3 text-sm";
export async function ReclamationRefundCard({ id, quantity }: { id: string; quantity: number }) {
  const state = await loadReclamationRefund(id);
  if (state.legacyResolved) return null;
  const processing = Boolean(state.automationJob && ["QUEUED", "RUNNING", "RETRY"].includes(state.automationJob.status));
  const complete = state.payout?.status === "COMPLETED";
  const amount = state.amount == null ? "—" : new Intl.NumberFormat("sr-Latn-RS", { style: "currency", currency: "RSD" }).format(state.amount);
  return <Card>
    <CardTitle description={`${quantity} kom · primljeno u magacin ${state.received} kom · ${amount}`}>Povrat novca na račun kupca</CardTitle>
    <p className="mb-4 text-sm text-ink-600">Refundira se samo količina ove reklamacije, bez dostave. Već primljena roba se ne dodaje ponovo na lager. Kada je primljena cela odobrena količina, ERP automatski pokreće fiskalnu refundaciju i šalje podršci mejl sa linkom do reklamacije radi provere isplate. Novac u banci šaljete ručno.</p>
    {!state.fiscalComplete && processing && <p role="status" className="mb-4 text-sm">Automatska fiskalna refundacija je u obradi. Osvežite pregled za status.</p>}
    {!state.fiscalComplete && state.automationJob?.lastError && <p role="alert" className="mb-4 text-sm text-destructive">{state.automationJob.lastError}</p>}
    {state.problem && <p role="alert" className="mb-4 text-sm text-destructive">{state.problem}</p>}
    {state.documents.map(doc => <p key={doc.id} className="mb-2 text-sm">Fiskalna refundacija: {doc.receiptNumber ?? "bez broja"} · {doc.status}{doc.error ? ` · ${doc.error}` : ""}</p>)}
    {complete ? <p className="rounded-lg bg-muted-bg p-4 text-sm">Isplata {amount} je potvrđena. Referenca: {state.payout?.providerRef}.</p> : !state.fiscalComplete ? <AdminActionForm action={issueClaimRefundAction} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink-600">Naplata prvobitne porudžbine proverava se iz sistema. Račun kupca i lična karta se ne unose u ovaj postupak.</p>
      <SubmitButton className="h-auto min-h-10 max-w-full whitespace-normal" disabled={processing || state.received < quantity || Boolean(state.problem)} pendingLabel="Izdavanje refundacije…" confirm={`Izdati fiskalnu refundaciju za ${quantity} kom (${amount})? Podrška zatim proverava da li je novac već vraćen kupcu.`}>Obradi primljeni povrat · {amount}</SubmitButton>
      {state.received < quantity && <p className="text-sm text-ink-600">Prvo evidentirajte prijem svih {quantity} kom u magacin.</p>}
    </AdminActionForm> : <AdminActionForm action={confirmClaimPayoutAction} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <p className="rounded-lg bg-muted-bg p-4 text-sm">Iznos povrata: <strong>{amount}</strong>. Fiskalna refundacija je završena. Prvo proverite da li je novac već vraćen kupcu; ako jeste, evidentirajte postojeću uplatu, bez ponovnog slanja novca.</p>
      <Field label="Datum izvršene uplate"><input type="date" name="paidAt" required className={inputClass} /></Field>
      <Field label="Referenca ili broj bankarskog naloga"><input name="reference" required maxLength={200} className={inputClass} /></Field>
      <label className="flex gap-2 text-sm"><input type="checkbox" name="confirmed" required />Potvrđujem da sam kupcu stvarno uplatio {amount} na njegov račun.</label>
      <SubmitButton className="h-auto min-h-10 max-w-full whitespace-normal" pendingLabel="Evidentiranje isplate…" confirm="Potvrditi izvršenu uplatu i zatvoriti reklamaciju?">Novac je vraćen kupcu · reši reklamaciju</SubmitButton>
    </AdminActionForm>}
  </Card>;
}
