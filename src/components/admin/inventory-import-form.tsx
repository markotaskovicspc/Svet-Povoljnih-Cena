"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [state, formAction] = useActionState(
    action,
    EMPTY_ADMIN_ACTION_STATE as AdminActionState<InventoryImportPreviewResult>,
  );
  const refreshedState = useRef(state);
  const result = state.ok ? state.result : undefined;

  useEffect(() => {
    if (!state.ok || !state.result?.applied || refreshedState.current === state) return;
    refreshedState.current = state;
    window.dispatchEvent(new Event("spc:erp-grid-refresh"));
    router.refresh();
  }, [router, state]);

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
      {result?.previewToken ? (
        <input type="hidden" name="previewToken" value={result.previewToken} />
      ) : null}
      <p className="text-xs text-ink-500">
        Obavezne kolone su <code>sku</code> i <code>qty</code>. Dimenzije su opcione.
        Artikli kojih nema u fajlu ostaju nepromenjeni.
      </p>
      {result?.previewToken ? (
        <p className="rounded-md border border-border/70 bg-muted-bg/40 px-3 py-2 text-xs text-ink-600">
          Za primenu ponovo izaberite isti fajl. Sistem proverava njegov hash i trenutno
          stanje lagera pre atomskog upisa.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="mode"
          value="preview"
          variant="secondary"
          pendingLabel="Proveravam…"
        >
          Proveri fajl
        </SubmitButton>
        {result?.previewToken ? (
          <SubmitButton
            name="mode"
            value="apply"
            pendingLabel="Uvozim…"
            confirm="Primeniti tačno pregledano DC stanje? Samo navedeni artikli biće promenjeni, a svaka razlika će ostaviti magacinski trag."
          >
            Primeni pregledani uvoz
          </SubmitButton>
        ) : null}
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
