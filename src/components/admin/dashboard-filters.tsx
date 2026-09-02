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
import { REPORT_PERIOD_PRESETS } from "@/lib/admin/report-period";
import {
  DASHBOARD_PERIOD_NAMES,
  type DashboardFilterContext,
  type DashboardFilterParams,
  type DashboardPeriodName,
} from "@/lib/admin/dashboard-context";

export type { DashboardFilterContext } from "@/lib/admin/dashboard-context";

type DashboardSavedView = {
  id?: string;
  name: string;
  isDefault?: boolean;
  context?: DashboardFilterParams;
};

const subscribeToClientRuntime = () => () => {};

function useClientReady() {
  return useSyncExternalStore(
    subscribeToClientRuntime,
    () => true,
    () => false,
  );
}

function savedViewPayload(
  name: string,
  context: DashboardFilterParams,
  isDefault: boolean,
) {
  return {
    module: "dashboard",
    name,
    query: "",
    filters: [],
    sorting: [],
    visibleColumns: [],
    columnOrder: [],
    columnWidths: {},
    context,
    isDefault,
  };
}

function normalizeLegacyContext(context: DashboardFilterParams) {
  const normalized: DashboardFilterParams = { ...context };
  for (const name of DASHBOARD_PERIOD_NAMES) {
    const rangeKey = `${name}Range` as const;
    const fromKey = `${name}From` as const;
    const toKey = `${name}To` as const;
    if (!normalized[rangeKey] && normalized[fromKey] && normalized[toKey]) {
      normalized[rangeKey] = "custom";
    }
  }
  return normalized;
}

function replaceSavedView(
  current: DashboardSavedView[],
  saved: DashboardSavedView,
) {
  const next = current
    .filter((view) => view.name !== saved.name)
    .map((view) => (saved.isDefault ? { ...view, isDefault: false } : view));
  return [saved, ...next].sort((left, right) => {
    if (Boolean(left.isDefault) !== Boolean(right.isDefault)) {
      return left.isDefault ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "sr-Latn");
  });
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
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const contextKey = Object.values(context).join("|");
  const [draftState, setDraftState] = useState({
    sourceKey: contextKey,
    value: context,
  });
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

  const navigateTo = (next: DashboardFilterParams) => {
    const appliedContext = {
      ...context,
      ...normalizeLegacyContext(next),
    };
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
        body: JSON.stringify(savedViewPayload(name, context, saveAsDefault)),
      });
      const payload = (await response.json().catch(() => null)) as
        | { view?: DashboardSavedView; error?: string }
        | null;
      if (!response.ok || !payload?.view) {
        setMessage(payload?.error ?? "Pogled nije sačuvan.");
        return;
      }
      setViews((current) => replaceSavedView(current, payload.view!));
      setSaveName("");
      setSaveAsDefault(true);
      setShowSaveForm(false);
      setMessage(
        payload.view.isDefault
          ? `Pogled „${payload.view.name}” je sačuvan kao podrazumevani.`
          : `Pogled „${payload.view.name}” je sačuvan.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const setDefaultView = async (view: DashboardSavedView) => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          savedViewPayload(view.name, view.context ?? {}, true),
        ),
      });
      const payload = (await response.json().catch(() => null)) as
        | { view?: DashboardSavedView; error?: string }
        | null;
      if (!response.ok || !payload?.view) {
        setMessage(payload?.error ?? "Podrazumevani pogled nije promenjen.");
        return;
      }
      setViews((current) => replaceSavedView(current, payload.view!));
      setMessage(`Pogled „${payload.view.name}” je sada podrazumevani.`);
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
    setMessage(
      view.isDefault
        ? `Podrazumevani pogled „${view.name}” je obrisan. Pri sledećem otvaranju koristiće se ugrađeni izbor.`
        : `Pogled „${view.name}” je obrisan.`,
    );
  };

  return (
    <div
      className="space-y-4 rounded-xl border border-border/60 bg-surface p-4"
      aria-busy={!clientReady || saving}
      data-client-ready={clientReady ? "true" : "false"}
    >
      <fieldset className="contents" disabled={!clientReady || saving}>
        <form method="get" className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          <label className="text-xs font-medium text-ink-600">
            Magacin
            <select
              name="warehouseId"
              value={draft.warehouseId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  warehouseId: event.currentTarget.value,
                }))
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
          <DateRange name="orders" label="Porudžbine" draft={draft} setDraft={setDraft} />
          <DateRange name="fiscal" label="Fiskalni promet" draft={draft} setDraft={setDraft} />
          <DateRange name="reclamations" label="Reklamacije" draft={draft} setDraft={setDraft} />
          <DateRange name="topProducts" label="Top proizvodi" draft={draft} setDraft={setDraft} />
          <DateRange name="analytics" label="Posete i konverzije" draft={draft} setDraft={setDraft} />
          <div className="flex flex-wrap gap-2 xl:col-span-2 2xl:col-span-3">
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
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted-bg/40 p-3"
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
            <label className="flex h-9 items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(event) => setSaveAsDefault(event.currentTarget.checked)}
              />
              Učitaj automatski
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
              <span
                key={view.id ?? view.name}
                className="inline-flex items-center rounded-full border border-border"
              >
                <button
                  type="button"
                  onClick={() => navigateTo(view.context ?? {})}
                  className="px-3 py-1.5 text-ink-700 hover:text-walnut"
                >
                  {view.name}
                  {view.isDefault ? " · podrazumevani" : ""}
                </button>
                {!view.isDefault ? (
                  <button
                    type="button"
                    aria-label={`Postavi pogled ${view.name} kao podrazumevani`}
                    onClick={() => void setDefaultView(view)}
                    className="border-l border-border px-2 text-ink-500 hover:text-walnut"
                  >
                    ★
                  </button>
                ) : null}
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
  name,
  label,
  draft,
  setDraft,
}: {
  name: DashboardPeriodName;
  label: string;
  draft: DashboardFilterContext;
  setDraft: Dispatch<SetStateAction<DashboardFilterContext>>;
}) {
  const rangeKey = `${name}Range` as const;
  const fromKey = `${name}From` as const;
  const toKey = `${name}To` as const;
  const custom = draft[rangeKey] === "custom";

  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-ink-600">{label}</legend>
      <select
        aria-label={`${label} period`}
        name={rangeKey}
        value={draft[rangeKey]}
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            [rangeKey]: event.currentTarget.value,
          }))
        }
        className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm"
      >
        {REPORT_PERIOD_PRESETS.map((preset) => (
          <option key={preset.key} value={preset.key}>{preset.label}</option>
        ))}
        <option value="custom">Tačan raspon</option>
      </select>
      {custom ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label={`${label} od`}
            name={fromKey}
            type="date"
            required
            value={draft[fromKey]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [fromKey]: event.currentTarget.value,
              }))
            }
            className="h-9"
          />
          <Input
            aria-label={`${label} do`}
            name={toKey}
            type="date"
            required
            value={draft[toKey]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [toKey]: event.currentTarget.value,
              }))
            }
            className="h-9"
          />
        </div>
      ) : (
        <p className="px-1 text-[11px] text-ink-500">
          {draft[fromKey]} – {draft[toKey]}
        </p>
      )}
    </fieldset>
  );
}
