"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
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

const subscribeToClientRuntime = () => () => {};

function useClientReady() {
  return useSyncExternalStore(
    subscribeToClientRuntime,
    () => true,
    () => false,
  );
}

export function DashboardFilters({
  context,
  warehouses,
}: {
  context: DashboardFilterContext;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) {
  const clientReady = useClientReady();
  const router = useRouter();
  const [views, setViews] = useState<DashboardSavedView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const contextKey = [
    context.warehouseId,
    context.ordersFrom,
    context.ordersTo,
    context.fiscalFrom,
    context.fiscalTo,
    context.reclamationsFrom,
    context.reclamationsTo,
    context.topProductsFrom,
    context.topProductsTo,
  ].join("|");
  const [draftState, setDraftState] = useState({ sourceKey: contextKey, value: context });
  const draft = draftState.sourceKey === contextKey ? draftState.value : context;
  const setDraft: Dispatch<SetStateAction<DashboardFilterContext>> = (nextDraft) => {
    setDraftState({
      sourceKey: contextKey,
      value: typeof nextDraft === "function" ? nextDraft(draft) : nextDraft,
    });
  };

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
    const appliedContext = { ...context, ...next };
    setDraft(appliedContext);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(appliedContext)) {
      if (value) params.set(key, value);
    }
    router.push(`/admin?${params.toString()}`);
  };

  const saveView = async () => {
    const name = saveName.trim();
    if (!name) {
      setMessage("Unesite naziv dashboard pogleda.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
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
      setSaveName("");
      setShowSaveForm(false);
      setMessage(`Pogled „${payload.view.name}” je sačuvan.`);
    } finally {
      setSaving(false);
    }
  };

  const deleteView = async (view: DashboardSavedView) => {
    if (!view.id) return;
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
    setPendingDeleteId(null);
    setMessage(`Pogled „${view.name}” je obrisan.`);
  };

  return (
    <div
      className="space-y-4 rounded-xl border border-border/60 bg-surface p-4"
      aria-busy={!clientReady || saving}
      data-client-ready={clientReady ? "true" : "false"}
    >
      <fieldset className="contents" disabled={!clientReady || saving}>
      <form method="get" className="grid gap-3 lg:grid-cols-5">
        <label className="text-xs font-medium text-ink-600">
          Magacin
          <select
            name="warehouseId"
            value={draft.warehouseId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, warehouseId: event.currentTarget.value }))
            }
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
        <DateRange label="Porudžbine" from="ordersFrom" to="ordersTo" draft={draft} setDraft={setDraft} />
        <DateRange label="Fiskalni promet" from="fiscalFrom" to="fiscalTo" draft={draft} setDraft={setDraft} />
        <DateRange
          label="Reklamacije"
          from="reclamationsFrom"
          to="reclamationsTo"
          draft={draft}
          setDraft={setDraft}
        />
        <DateRange
          label="Top proizvodi"
          from="topProductsFrom"
          to="topProductsTo"
          draft={draft}
          setDraft={setDraft}
        />
        <div className="flex flex-wrap gap-2 lg:col-span-5">
          <button className="rounded-lg bg-walnut px-4 py-2 text-sm font-medium text-white">
            Primeni filtere
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSaveForm(true);
              setMessage(null);
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-700"
          >
            Sačuvaj pogled
          </button>
        </div>
      </form>

      {showSaveForm ? (
        <div
          role="group"
          aria-label="Novi sačuvani dashboard pogled"
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-muted-bg/40 p-3"
        >
          <label className="min-w-64 flex-1 text-xs font-medium text-ink-600">
            Naziv dashboard pogleda
            <Input
              autoFocus
              value={saveName}
              onChange={(event) => setSaveName(event.currentTarget.value)}
              className="mt-1 h-9 bg-surface"
            />
          </label>
          <button
            type="button"
            onClick={saveView}
            className="rounded-lg bg-walnut px-4 py-2 text-sm font-medium text-white"
          >
            {saving ? "Čuvanje…" : "Sačuvaj"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSaveForm(false);
              setSaveName("");
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-700"
          >
            Otkaži
          </button>
        </div>
      ) : null}

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
                aria-label={
                  pendingDeleteId === view.id
                    ? `Potvrdi brisanje ${view.name}`
                    : `Obriši pogled ${view.name}`
                }
                onClick={() => {
                  if (pendingDeleteId === view.id) void deleteView(view);
                  else setPendingDeleteId(view.id ?? null);
                }}
                className="border-l border-border px-2 text-danger"
              >
                {pendingDeleteId === view.id ? "Potvrdi" : "×"}
              </button>
              {pendingDeleteId === view.id ? (
                <button
                  type="button"
                  aria-label={`Otkaži brisanje ${view.name}`}
                  onClick={() => setPendingDeleteId(null)}
                  className="border-l border-border px-2 text-ink-500"
                >
                  Otkaži
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {message ? <p role="status" className="text-xs text-ink-500">{message}</p> : null}
      </fieldset>
    </div>
  );
}

function DateRange({
  label,
  from,
  to,
  draft,
  setDraft,
}: {
  label: string;
  from: keyof DashboardFilterContext;
  to: keyof DashboardFilterContext;
  draft: DashboardFilterContext;
  setDraft: Dispatch<SetStateAction<DashboardFilterContext>>;
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="text-xs font-medium text-ink-600">{label}</legend>
      <Input
        aria-label={`${label} od`}
        name={from}
        type="date"
        value={draft[from]}
        onChange={(event) =>
          setDraft((current) => ({ ...current, [from]: event.currentTarget.value }))
        }
        className="mt-1 h-9"
      />
      <Input
        aria-label={`${label} do`}
        name={to}
        type="date"
        value={draft[to]}
        onChange={(event) =>
          setDraft((current) => ({ ...current, [to]: event.currentTarget.value }))
        }
        className="mt-1 h-9"
      />
    </fieldset>
  );
}
