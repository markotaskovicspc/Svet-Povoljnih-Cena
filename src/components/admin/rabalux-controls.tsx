"use client";

import { useActionState } from "react";
import type { AdminActionState } from "@/lib/admin/action-state";
import { EMPTY_ADMIN_ACTION_STATE } from "@/lib/admin/action-state";
import type { RabaluxPreviewResult } from "@/lib/rabalux/admin-sync";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type PreviewAction = (
  state: AdminActionState<RabaluxPreviewResult>,
  data: FormData,
) => Promise<AdminActionState<RabaluxPreviewResult>>;
type ExecuteAction = (
  state: AdminActionState,
  data: FormData,
) => Promise<AdminActionState>;

export function RabaluxControls({
  previewAction,
  executeAction,
}: {
  previewAction: PreviewAction;
  executeAction: ExecuteAction;
}) {
  const [previewState, runPreview] = useActionState(
    previewAction,
    EMPTY_ADMIN_ACTION_STATE as AdminActionState<RabaluxPreviewResult>,
  );
  const [executeState, execute] = useActionState(
    executeAction,
    EMPTY_ADMIN_ACTION_STATE,
  );
  const preview = previewState.ok ? previewState.result : undefined;

  return (
    <div className="space-y-4">
      <form action={runPreview} className="flex flex-wrap items-end gap-3">
        <Field label="Akcija">
          <select
            name="target"
            defaultValue="catalog"
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            <option value="catalog">Katalog sync</option>
            <option value="stock">Stock sync</option>
            <option value="media">Media sync</option>
          </select>
        </Field>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Proveravam…">
          Napravi live preview
        </SubmitButton>
      </form>
      {previewState.message ? (
        <p role={previewState.ok ? "status" : "alert"} className="text-sm">
          {previewState.message}
        </p>
      ) : null}
      {preview ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Katalog" value={preview.summary.catalogRows} />
            <Stat label="Stock" value={preview.summary.stockRows} />
            <Stat label="Nevažeće cene" value={preview.summary.invalidPrice} />
            <Stat
              label="Medija/dokumenti"
              value={
                preview.summary.videos +
                preview.summary.manuals +
                preview.summary.energyLabels +
                preview.summary.imageAssets
              }
            />
          </dl>
          <form action={execute} className="space-y-3">
            <input type="hidden" name="target" value={preview.target} />
            <input type="hidden" name="token" value={preview.token} />
            <Field label="Razlog">
              <Textarea name="reason" rows={2} minLength={5} maxLength={500} required />
            </Field>
            <Field label={`Upišite: ${preview.phrase}`}>
              <Input name="phrase" autoComplete="off" required />
            </Field>
            {executeState.message ? (
              <p role={executeState.ok ? "status" : "alert"} className="text-sm">
                {executeState.message}
              </p>
            ) : null}
            <SubmitButton
              size="sm"
              pendingLabel="Pokrećem…"
              confirm="Potvrditi izvršenje proverene administratorske akcije?"
            >
              Izvrši preview-ovanu akciju
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
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
