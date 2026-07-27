"use client";

import { useActionState } from "react";
import {
  EMPTY_ADMIN_ACTION_STATE,
  type AdminActionState,
} from "@/lib/admin/action-state";
import type { InventoryImportPreviewResult } from "@/lib/inventory-csv";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { cn } from "@/lib/utils";

type InventoryImportAction = (
  state: AdminActionState<InventoryImportPreviewResult>,
  formData: FormData,
) => Promise<AdminActionState<InventoryImportPreviewResult>>;

export function InventoryImportForm({ action }: { action: InventoryImportAction }) {
  const [state, formAction] = useActionState(
    action,
    EMPTY_ADMIN_ACTION_STATE as AdminActionState<InventoryImportPreviewResult>,
  );
  const result = state.ok ? state.result : undefined;

  return (
    <form action={formAction} className="space-y-3">
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            state.ok
              ? "border-success/25 bg-success/10 text-success"
              : "border-destructive/25 bg-destructive/10 text-destructive",
          )}
        >
          {state.message}
        </p>
      ) : null}
      <Field label="CSV ili XLSX fajl">
        <Input
          name="file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
        />
      </Field>
      <p className="text-xs text-ink-500">
        Obavezne kolone su <code>sku</code> i <code>qty</code>. Dimenzije su opcione.
        Artikli kojih nema u fajlu ostaju nepromenjeni.
      </p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="mode"
          value="preview"
          variant="secondary"
          pendingLabel="Proveravam…"
        >
          Proveri fajl
        </SubmitButton>
        <SubmitButton
          name="mode"
          value="apply"
          pendingLabel="Uvozim…"
          confirm="Primeniti DC stanje iz fajla? Samo navedeni artikli biće promenjeni, a svaka razlika će ostaviti magacinski trag."
        >
          Primeni uvoz
        </SubmitButton>
      </div>
      {result ? (
        <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Redova" value={result.rows} />
            <Stat label="Promene" value={result.changed} />
            <Stat label="Bez promene" value={result.unchanged} />
            <Stat label="Sa dimenzijama" value={result.dimensionsRows} />
            <Stat label="Ulaz komada" value={result.increasedUnits} />
            <Stat label="Izlaz komada" value={result.decreasedUnits} />
          </dl>
          {result.samples.length ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-muted text-ink-500">
                  <tr>
                    <th className="px-2 py-1.5">SKU</th>
                    <th className="px-2 py-1.5 text-right">Trenutno</th>
                    <th className="px-2 py-1.5 text-right">Novo</th>
                    <th className="px-2 py-1.5 text-right">Razlika</th>
                  </tr>
                </thead>
                <tbody>
                  {result.samples.map((sample) => (
                    <tr key={sample.sku}>
                      <td className="px-2 py-1.5 font-mono">{sample.sku}</td>
                      <td className="px-2 py-1.5 text-right">{sample.current}</td>
                      <td className="px-2 py-1.5 text-right">{sample.target}</td>
                      <td className="px-2 py-1.5 text-right">
                        {sample.delta > 0 ? "+" : ""}{sample.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="font-mono font-semibold">{value}</dd>
    </div>
  );
}
