"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export type DashboardFilterContext = {
  warehouseId: string;
  ordersFrom: string;
  ordersTo: string;
  fiscalFrom: string;
  fiscalTo: string;
  reclamationsFrom: string;
  reclamationsTo: string;
  topProductsFrom: string;
  topProductsTo: string;
};

type DashboardSavedView = {
  id?: string;
  name: string;
  context?: Partial<DashboardFilterContext>;
};

export function DashboardFilters({
  context,
  warehouses,
}: {
  context: DashboardFilterContext;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [views, setViews] = useState<DashboardSavedView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/saved-views?module=dashboard")
      .then(async (response) => {
        const payload = (await response.json()) as { views?: DashboardSavedView[] };
        if (!response.ok) throw new Error("Pogledi nisu učitani.");
        if (active) setViews(payload.views ?? []);
      })
      .catch(() => {
        if (active) setMessage("Sačuvani pogledi trenutno nisu dostupni.");
      });
    return () => {
      active = false;
    };
  }, []);

  const navigateTo = (next: Partial<DashboardFilterContext>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...context, ...next })) {
      if (value) params.set(key, value);
    }
    router.push(`/admin?${params.toString()}`);
  };

  const saveView = async () => {
    const name = window.prompt("Naziv dashboard pogleda")?.trim();
    if (!name) return;
    setMessage(null);
    const response = await fetch("/api/admin/saved-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        module: "dashboard",
        name,
        query: "",
        filters: [],
        sorting: [],
        visibleColumns: [],
        columnOrder: [],
        columnWidths: {},
        context,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { view?: DashboardSavedView; error?: string }
      | null;
    if (!response.ok || !payload?.view) {
      setMessage(payload?.error ?? "Pogled nije sačuvan.");
      return;
    }
    setViews((current) => [
      ...current.filter((view) => view.name !== payload.view!.name),
      payload.view!,
    ]);
    setMessage(`Pogled „${payload.view.name}” je sačuvan.`);
  };

  const deleteView = async (view: DashboardSavedView) => {
    if (!view.id || !window.confirm(`Obrisati pogled „${view.name}”?`)) return;
    const response = await fetch("/api/admin/saved-views", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: view.id }),
    });
    if (!response.ok) {
      setMessage("Pogled nije obrisan.");
      return;
    }
    setViews((current) => current.filter((item) => item.id !== view.id));
    setMessage(`Pogled „${view.name}” je obrisan.`);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-surface p-4">
      <form method="get" className="grid gap-3 lg:grid-cols-5">
        <label className="text-xs font-medium text-ink-600">
          Magacin
          <select
            name="warehouseId"
            defaultValue={context.warehouseId}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm"
          >
            <option value="">Svi magacini</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name} ({warehouse.code})
              </option>
            ))}
          </select>
        </label>
        <DateRange label="Porudžbine" from="ordersFrom" to="ordersTo" context={context} />
        <DateRange label="Fiskalni promet" from="fiscalFrom" to="fiscalTo" context={context} />
        <DateRange
          label="Reklamacije"
          from="reclamationsFrom"
          to="reclamationsTo"
          context={context}
        />
        <DateRange
          label="Top proizvodi"
          from="topProductsFrom"
          to="topProductsTo"
          context={context}
        />
        <div className="flex flex-wrap gap-2 lg:col-span-5">
          <button className="rounded-lg bg-walnut px-4 py-2 text-sm font-medium text-white">
            Primeni filtere
          </button>
          <button
            type="button"
            onClick={saveView}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-700"
          >
            Sačuvaj pogled
          </button>
        </div>
      </form>

      {views.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-500">Sačuvani pogledi:</span>
          {views.map((view) => (
            <span key={view.id ?? view.name} className="inline-flex rounded-full border border-border">
              <button
                type="button"
                onClick={() => navigateTo(view.context ?? {})}
                className="px-3 py-1.5 text-ink-700 hover:text-walnut"
              >
                {view.name}
              </button>
              <button
                type="button"
                aria-label={`Obriši pogled ${view.name}`}
                onClick={() => deleteView(view)}
                className="border-l border-border px-2 text-danger"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {message ? <p role="status" className="text-xs text-ink-500">{message}</p> : null}
    </div>
  );
}

function DateRange({
  label,
  from,
  to,
  context,
}: {
  label: string;
  from: keyof DashboardFilterContext;
  to: keyof DashboardFilterContext;
  context: DashboardFilterContext;
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="text-xs font-medium text-ink-600">{label}</legend>
      <Input aria-label={`${label} od`} name={from} type="date" defaultValue={context[from]} className="mt-1 h-9" />
      <Input aria-label={`${label} do`} name={to} type="date" defaultValue={context[to]} className="mt-1 h-9" />
    </fieldset>
  );
}
