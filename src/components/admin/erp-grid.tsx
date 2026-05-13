"use client";

import { useMemo, useState } from "react";
import { Download, Eye, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ErpColumn, ErpCommand, ErpModule, ErpValue } from "@/lib/admin/erp";

type FilterCriterion = {
  id: string;
  columnKey: string;
  value: string;
};

type SavedView = {
  name: string;
  visibleColumns: string[];
  filters: FilterCriterion[];
  query: string;
};

function textValue(value: ErpValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Da" : "Ne";
  return String(value);
}

function formatValue(value: ErpValue, column: ErpColumn) {
  if (value === null || value === undefined || value === "") return "—";
  if (column.type === "boolean") return value ? "Da" : "Ne";
  if (column.type === "money" && typeof value === "number") {
    return new Intl.NumberFormat("sr-Latn-RS", {
      maximumFractionDigits: 2,
      minimumFractionDigits: value % 1 ? 2 : 0,
    }).format(value);
  }
  if (column.type === "number" && typeof value === "number") {
    return new Intl.NumberFormat("sr-Latn-RS", {
      maximumFractionDigits: 2,
    }).format(value);
  }
  return textValue(value);
}

function statusClass(value: ErpValue) {
  const v = textValue(value).toLowerCase();
  if (["sp", "poslata", "potvrđena", "primljena", "objavljeno"].some((x) => v.includes(x))) {
    return "bg-success/10 text-success ring-success/20";
  }
  if (["dtz", "u obradi", "u pripremi", "predlog"].some((x) => v.includes(x))) {
    return "bg-warning/10 text-warning ring-warning/20";
  }
  if (["arh", "čeka", "ceka"].some((x) => v.includes(x))) {
    return "bg-ink-500/10 text-ink-500 ring-ink-500/20";
  }
  return "bg-brand-blue-50 text-brand-blue ring-brand-blue/15";
}

function commandClass(tone: ErpCommand["tone"]) {
  if (tone === "danger") return "border-danger/30 text-danger hover:bg-danger/10";
  if (tone === "primary") return "bg-ink-900 text-canvas hover:bg-walnut";
  return "";
}

function storageKey(moduleSlug: string) {
  return `svet-akcija:erp:${moduleSlug}:views`;
}

function readViews(moduleSlug: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(moduleSlug));
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function writeViews(moduleSlug: string, views: SavedView[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(moduleSlug), JSON.stringify(views));
}

export function ErpGrid({ module }: { module: ErpModule }) {
  const defaultColumns = useMemo(
    () =>
      module.columns
        .filter((c) => c.defaultVisible)
        .map((c) => c.key),
    [module.columns],
  );
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterCriterion[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultColumns);
  const [views, setViews] = useState<SavedView[]>(() => readViews(module.slug));
  const [newFilterColumn, setNewFilterColumn] = useState(module.columns[0]?.key ?? "");

  const visible = useMemo(
    () => module.columns.filter((c) => visibleColumns.includes(c.key)),
    [module.columns, visibleColumns],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return module.rows.filter((row) => {
      if (q) {
        const hay = visible
          .map((c) => textValue(row.values[c.key]))
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return filters.every((filter) => {
        const needle = filter.value.trim().toLowerCase();
        if (!needle) return true;
        return textValue(row.values[filter.columnKey]).toLowerCase().includes(needle);
      });
    });
  }, [filters, module.rows, query, visible]);

  const addFilter = () => {
    if (!newFilterColumn) return;
    setFilters((current) => [
      ...current,
      { id: crypto.randomUUID(), columnKey: newFilterColumn, value: "" },
    ]);
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns((current) =>
      current.includes(key)
        ? current.filter((c) => c !== key)
        : [...current, key],
    );
  };

  const saveView = () => {
    const name = window.prompt("Naziv pogleda");
    if (!name?.trim()) return;
    const next = [
      ...views.filter((v) => v.name !== name.trim()),
      { name: name.trim(), visibleColumns, filters, query },
    ];
    setViews(next);
    writeViews(module.slug, next);
  };

  const applyView = (view: SavedView) => {
    setVisibleColumns(view.visibleColumns);
    setFilters(view.filters);
    setQuery(view.query);
  };

  const exportCsv = () => {
    const rows = [
      visible.map((c) => c.label),
      ...filteredRows.map((row) => visible.map((c) => textValue(row.values[c.key]))),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${cell.replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${module.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative max-w-xl flex-1">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Brza pretraga po vidljivim kolonama"
                  className="h-9"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={newFilterColumn}
                  onChange={(e) => setNewFilterColumn(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-surface px-2 text-sm"
                  aria-label="Kolona za novi filter"
                >
                  {module.columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={addFilter}>
                  <Plus className="size-4" aria-hidden />
                  Filter
                </Button>
              </div>
            </div>

            {filters.length ? (
              <div className="flex flex-wrap gap-2">
                {filters.map((filter) => {
                  const column = module.columns.find((c) => c.key === filter.columnKey);
                  return (
                    <div
                      key={filter.id}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted-bg/50 px-2 py-1"
                    >
                      <span className="text-xs text-ink-500">
                        {column?.label ?? filter.columnKey}
                      </span>
                      <input
                        value={filter.value}
                        onChange={(e) =>
                          setFilters((current) =>
                            current.map((f) =>
                              f.id === filter.id ? { ...f, value: e.target.value } : f,
                            ),
                          )
                        }
                        className="h-7 w-40 rounded-md border border-input bg-surface px-2 text-xs outline-none focus:border-ring"
                        aria-label={`Filter ${column?.label ?? filter.columnKey}`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setFilters((current) => current.filter((f) => f.id !== filter.id))
                        }
                        className="text-ink-300 hover:text-danger"
                        aria-label="Ukloni filter"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {module.commands.map((command) => (
              <Button
                key={command.label}
                type="button"
                variant={command.tone === "primary" ? "default" : "outline"}
                className={commandClass(command.tone)}
              >
                {command.label}
              </Button>
            ))}
            <Button type="button" variant="outline" onClick={exportCsv}>
              <Download className="size-4" aria-hidden />
              Excel
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 rounded-2xl border border-border/60 bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <p className="text-sm text-ink-500">
              {filteredRows.length} redova · {visible.length} vidljivih kolona
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={saveView}>
                <Save className="size-4" aria-hidden />
                Snimi pogled
              </Button>
              <Button type="button" variant="outline" onClick={() => setVisibleColumns(defaultColumns)}>
                Reset kolona
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted-bg/70 text-xs uppercase tracking-[0.12em] text-ink-500">
                <tr>
                  {visible.map((column) => (
                    <th
                      key={column.key}
                      className={cn(
                        "whitespace-nowrap px-4 py-3 text-left font-medium",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted-bg/30">
                    {visible.map((column) => {
                      const value = row.values[column.key];
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            "whitespace-nowrap px-4 py-3 text-ink-700",
                            column.align === "right" && "text-right tabular-nums",
                            column.align === "center" && "text-center",
                          )}
                        >
                          {column.type === "status" ? (
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                                statusClass(value),
                              )}
                            >
                              {formatValue(value, column)}
                            </span>
                          ) : column.type === "boolean" ? (
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs ring-1",
                                value
                                  ? "bg-success/10 text-success ring-success/20"
                                  : "bg-danger/10 text-danger ring-danger/20",
                              )}
                            >
                              {formatValue(value, column)}
                            </span>
                          ) : column.key === "photo" ? (
                            <span className="inline-flex size-8 items-center justify-center rounded-md bg-muted-bg text-[10px] text-ink-500 ring-1 ring-border/60">
                              IMG
                            </span>
                          ) : (
                            formatValue(value, column)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Settings2 className="size-4 text-ink-500" aria-hidden />
              <h2 className="text-sm font-medium text-ink-900">Kolone</h2>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {module.columns.map((column) => (
                <label key={column.key} className="flex items-center gap-2 text-sm text-ink-700">
                  <Checkbox
                    checked={visibleColumns.includes(column.key)}
                    onCheckedChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Eye className="size-4 text-ink-500" aria-hidden />
              <h2 className="text-sm font-medium text-ink-900">Pogledi</h2>
            </div>
            {views.length ? (
              <div className="space-y-2">
                {views.map((view) => (
                  <button
                    key={view.name}
                    type="button"
                    onClick={() => applyView(view)}
                    className="block w-full rounded-lg border border-border/60 px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-muted-bg"
                  >
                    {view.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                Snimite kombinaciju filtera i kolona kao lični pogled.
              </p>
            )}
          </div>

          {module.notes?.length ? (
            <div className="rounded-2xl border border-border/60 bg-muted-bg/40 p-4">
              <h2 className="text-sm font-medium text-ink-900">Napomene iz specifikacije</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-600">
                {module.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
