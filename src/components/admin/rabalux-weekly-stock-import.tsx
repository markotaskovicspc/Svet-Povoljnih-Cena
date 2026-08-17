"use client";

import { useActionState } from "react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { EMPTY_ADMIN_ACTION_STATE } from "@/lib/admin/action-state";
import type {
  RabaluxWeeklyStockApplyResult,
  RabaluxWeeklyStockPreviewResult,
} from "@/lib/rabalux/weekly-stock";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PreviewAction = (
  state: AdminActionState<RabaluxWeeklyStockPreviewResult>,
  data: FormData,
) => Promise<AdminActionState<RabaluxWeeklyStockPreviewResult>>;

type ApplyAction = (
  state: AdminActionState<RabaluxWeeklyStockApplyResult>,
  data: FormData,
) => Promise<AdminActionState<RabaluxWeeklyStockApplyResult>>;

export function RabaluxWeeklyStockImport({
  previewAction,
  applyAction,
}: {
  previewAction: PreviewAction;
  applyAction: ApplyAction;
}) {
  const [previewState, preview] = useActionState(
    previewAction,
    EMPTY_ADMIN_ACTION_STATE as AdminActionState<RabaluxWeeklyStockPreviewResult>,
  );
  const [applyState, apply] = useActionState(
    applyAction,
    EMPTY_ADMIN_ACTION_STATE as AdminActionState<RabaluxWeeklyStockApplyResult>,
  );
  const result = previewState.ok ? previewState.result : undefined;

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium text-ink">Nedeljni lager za Srbiju</p>
        <p className="mt-1 text-xs text-ink-500">
          XLSX je potpuna lista Rabalux proizvoda za Srbiju. Šifra koje nema u
          fajlu briše se iz baze; 0–9 ostaje vidljivo bez kupovine, a 10+ je
          dostupno za kupovinu kada su kataloški podaci spremni.
        </p>
      </div>
      <form action={preview} className="flex flex-wrap items-end gap-3">
        <Field label="Rabalux XLSX stanje">
          <Input
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
          />
        </Field>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Proveravam…">
          Proveri XLSX
        </SubmitButton>
      </form>
      <ActionMessage state={previewState} />

      {result ? (
        <div className="space-y-4 border-t border-border pt-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Datum izveštaja" value={result.summary.reportDate} />
            <Stat label="Jedinstvenih SKU" value={result.summary.uniqueSkus} />
            <Stat label="Ukupno komada" value={result.summary.totalUnits} />
            <Stat label="Pozitivno stanje" value={result.summary.positiveSkus} />
            <Stat label="1–9 komada" value={result.summary.lowStockSkus} />
            <Stat label="10+ komada" value={result.summary.activeThresholdSkus} />
            <Stat label="Stanje 0" value={result.summary.zeroStockSkus} />
            <Stat label="Poklapanje sa sajtom" value={result.summary.matchedSkus} />
            <Stat label="Samo u fajlu" value={result.summary.fileOnlySkus} />
            <Stat
              label="Novi iz fajla"
              value={result.summary.fileOnlySkus}
            />
            <Stat
              label="Za trajno brisanje"
              value={result.summary.siteOnlyProducts}
            />
            <Stat label="Promene stanja" value={result.summary.stockChanges} />
            <Stat label="Aktivacije" value={result.summary.activations} />
            <Stat label="Deaktivacije" value={result.summary.deactivations} />
            <Stat label="Trajna brisanja" value={result.summary.deletions} />
            <Stat
              label="Fajlovi za brisanje"
              value={result.summary.storageFilesToDelete}
            />
            <Stat label="Vraćanja" value={result.summary.restores} />
          </dl>
          {result.summary.samples.length ? (
            <div className="max-h-80 overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface-muted text-ink-500">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Naziv</th>
                    <th className="px-3 py-2 text-right">Sada</th>
                    <th className="px-3 py-2 text-right">Novo</th>
                    <th className="px-3 py-2">Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {result.summary.samples.map((sample, index) => (
                    <tr key={`${sample.sourceSku}-${index}`}>
                      <td className="px-3 py-2 font-mono">{sample.sourceSku}</td>
                      <td className="max-w-72 truncate px-3 py-2">{sample.name}</td>
                      <td className="px-3 py-2 text-right">{sample.current}</td>
                      <td className="px-3 py-2 text-right">{sample.target}</td>
                      <td className="px-3 py-2">{sample.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <form action={apply} className="space-y-3 rounded-lg bg-muted-bg/40 p-3">
            <input type="hidden" name="token" value={result.token} />
            <p className="text-xs text-ink-600">
              Поново изаберите исти XLSX. Систем проверава hash фајла и да ли се
              стање променило после preview-а.
            </p>
            <Field label="Isti pregledani XLSX">
              <Input
                name="file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
              />
            </Field>
            <Field label="Razlog primene">
              <Textarea name="reason" rows={2} minLength={5} maxLength={500} required />
            </Field>
            <Field label={`Upišite: ${result.phrase}`}>
              <Input name="phrase" autoComplete="off" required />
            </Field>
            <ActionMessage state={applyState} />
            <SubmitButton
              size="sm"
              pendingLabel="Primenjujem…"
              confirm="Primeniti kompletnu Rabalux listu za Srbiju? Proizvodi kojih nema u XLSX-u biće trajno obrisani iz baze, a njihovi fajlovi poslati na trajno brisanje. Ova radnja nema automatsko vraćanje."
            >
              Primeni pregledani lager
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ActionMessage({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  return (
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
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="font-mono font-semibold">{value}</dd>
    </div>
  );
}
