"use client";

import { useRef, useState } from "react";
import { Field } from "@/components/admin/field";
import type { ReclamationPackage } from "@/lib/admin/reclamation-packages";

const fields = [
  ["weightKg", "Težina (kg)", "0.001", 1000],
  ["widthCm", "Širina (cm)", "0.01", 500],
  ["depthCm", "Dužina (cm)", "0.01", 500],
  ["heightCm", "Visina (cm)", "0.01", 500],
] as const;

export function ReclamationPackages({ initialPackages }: { initialPackages: ReclamationPackage[] }) {
  const [rows, setRows] = useState(() => Array.from({ length: Math.max(1, initialPackages.length) }, (_, i) => i));
  const nextRow = useRef(rows.length);
  return <div className="space-y-3 sm:col-span-2">
    <p className="text-sm text-ink-600">Unesite stvarne mere svakog paketa zamene. Za deo merite zapakovani deo. Sve mere su obavezne za status „Spremno“.</p>
    <input type="hidden" name="replacementPackageRows" value={rows.join(",")} />
    {rows.map((row, i) => <fieldset key={row} className="rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Paket {i + 1}</legend>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label, step, max]) => <Field key={key} label={label}>
          <input name={`replacementPackage.${row}.${key}`} aria-label={`Paket ${i + 1} · ${label}`} type="number" min={step} max={max} step={step} defaultValue={initialPackages[row]?.[key] ?? ""} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm" />
        </Field>)}
      </div>
      {rows.length > 1 ? <button type="button" className="mt-2 text-sm text-destructive" onClick={() => setRows(rows.filter((id) => id !== row))}>Ukloni paket {i + 1}</button> : null}
    </fieldset>)}
    <button type="button" disabled={rows.length >= 99} className="rounded-lg border border-input px-3 py-2 text-sm disabled:opacity-50" onClick={() => setRows([...rows, nextRow.current++])}>Dodaj paket</button>
  </div>;
}
