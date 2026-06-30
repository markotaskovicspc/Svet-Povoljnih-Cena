"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Download,
  Eye,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ErpColumn, ErpCommand, ErpModule, ErpRow, ErpValue } from "@/lib/admin/erp";

type FilterCriterion = {
  id: string;
  columnKey: string;
  value: string;
};

type SavedView = {
  name: string;
  visibleColumns: string[];
  columnOrder: string[];
  filters: FilterCriterion[];
  query: string;
};

type EditingCell = {
  rowId: string;
  columnKey: string;
} | null;

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

function columnOrderKey(moduleSlug: string) {
  return `svet-akcija:erp:${moduleSlug}:column-order`;
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

function readColumnOrder(moduleSlug: string, columns: ErpColumn[]) {
  const defaultOrder = columns.map((column) => column.key);
  if (typeof window === "undefined") return defaultOrder;
  try {
    const raw = window.localStorage.getItem(columnOrderKey(moduleSlug));
    const stored = raw ? (JSON.parse(raw) as string[]) : [];
    const known = new Set(defaultOrder);
    const validStored = stored.filter((key) => known.has(key));
    const missing = defaultOrder.filter((key) => !validStored.includes(key));
    return [...validStored, ...missing];
  } catch {
    return defaultOrder;
  }
}

function writeColumnOrder(moduleSlug: string, order: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(columnOrderKey(moduleSlug), JSON.stringify(order));
}

function parseCellValue(value: string, column: ErpColumn, fallback: ErpValue): ErpValue {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (column.type === "number" || column.type === "money") {
    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return value;
}

function inputType(column: ErpColumn) {
  if (column.type === "date") return "date";
  if (column.type === "money" || column.type === "number") return "number";
  return "text";
}

export function ErpGrid({ module }: { module: ErpModule }) {
  const router = useRouter();
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
  const [cellEdits, setCellEdits] = useState<Record<string, Record<string, ErpValue>>>({});
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    readColumnOrder(module.slug, module.columns),
  );
  const [views, setViews] = useState<SavedView[]>(() => readViews(module.slug));
  const [newFilterColumn, setNewFilterColumn] = useState(module.columns[0]?.key ?? "");
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [savedCellCount, setSavedCellCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<EditingCell>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [commandMessage, setCommandMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  const visible = useMemo(
    () => {
      const byKey = new Map(module.columns.map((column) => [column.key, column]));
      return columnOrder
        .map((key) => byKey.get(key))
        .filter((column): column is ErpColumn => Boolean(column))
        .filter((column) => visibleColumns.includes(column.key));
    },
    [columnOrder, module.columns, visibleColumns],
  );

  const rows = useMemo<ErpRow[]>(
    () =>
      module.rows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          ...(cellEdits[row.id] ?? {}),
        },
      })),
    [cellEdits, module.rows],
  );

  const getSelectOptions = (column: ErpColumn, currentValue: ErpValue) => {
    const configuredOptions =
      column.options ??
      (column.type === "status"
        ? Array.from(
            new Set(
              rows
                .map((row) => textValue(row.values[column.key]))
                .filter(Boolean),
            ),
          )
        : []);
    const current = textValue(currentValue);
    if (current && !configuredOptions.includes(current)) {
      return [current, ...configuredOptions];
    }
    return configuredOptions;
  };

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
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
  }, [filters, query, rows, visible]);

  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selectedIds.has(row.id));

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (filteredRows.every((row) => next.has(row.id))) {
        filteredRows.forEach((row) => next.delete(row.id));
      } else {
        filteredRows.forEach((row) => next.add(row.id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runCommand = async (command: ErpCommand) => {
    if (command.href) {
      router.push(command.href);
      return;
    }
    if (!command.action) {
      setCommandMessage({ ok: false, text: "Komanda još nije povezana." });
      return;
    }
    const ids = Array.from(selectedIds);
    if (command.needsSelection && ids.length === 0) {
      setCommandMessage({ ok: false, text: "Izaberite bar jedan red." });
      return;
    }
    if (command.confirm && !window.confirm(command.confirm)) return;

    setRunningCommand(command.label);
    setCommandMessage(null);
    try {
      const res = await fetch(
        `/api/admin/erp/${encodeURIComponent(module.slug)}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: command.action, ids }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string; redirect?: string }
        | null;
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Komanda nije izvršena.");
      }
      setSelectedIds(new Set());
      if (payload.redirect) {
        router.push(payload.redirect);
        return;
      }
      setCommandMessage({ ok: true, text: payload.message ?? "Urađeno." });
      router.refresh();
    } catch (err) {
      setCommandMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Komanda nije izvršena.",
      });
    } finally {
      setRunningCommand(null);
    }
  };

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
      { name: name.trim(), visibleColumns, columnOrder, filters, query },
    ];
    setViews(next);
    writeViews(module.slug, next);
  };

  const applyView = (view: SavedView) => {
    setVisibleColumns(view.visibleColumns);
    if (view.columnOrder?.length) {
      setColumnOrder(view.columnOrder);
      writeColumnOrder(module.slug, view.columnOrder);
    }
    setFilters(view.filters);
    setQuery(view.query);
  };

  const commitCell = async (row: ErpRow, column: ErpColumn, value: ErpValue) => {
    if (!isEditMode) return;
    setEditingCell(null);
    setSaveError(null);
    setSavingCell({ rowId: row.id, columnKey: column.key });
    const previousEdits = cellEdits;
    setCellEdits((current) => ({
      ...current,
      [row.id]: {
        ...(current[row.id] ?? {}),
        [column.key]: value,
      },
    }));
    try {
      const res = await fetch(
        `/api/admin/erp/${encodeURIComponent(module.slug)}/rows/${encodeURIComponent(row.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ columnKey: column.key, value }),
        },
      );
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? "ERP izmena nije snimljena.");
      }
      setSavedCellCount((count) => count + 1);
    } catch (err) {
      setCellEdits(previousEdits);
      setSaveError(err instanceof Error ? err.message : "ERP izmena nije snimljena.");
    } finally {
      setSavingCell(null);
    }
  };

  const refreshRows = () => {
    setEditingCell(null);
    setSavedCellCount(0);
    setCellEdits({});
    setSaveError(null);
    router.refresh();
  };

  const resetColumns = () => {
    const defaultOrder = module.columns.map((column) => column.key);
    setVisibleColumns(defaultColumns);
    setColumnOrder(defaultOrder);
    writeColumnOrder(module.slug, defaultOrder);
  };

  const moveColumn = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setColumnOrder((current) => {
      const next = [...current];
      const sourceIndex = next.indexOf(sourceKey);
      const targetIndex = next.indexOf(targetKey);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      writeColumnOrder(module.slug, next);
      return next;
    });
  };

  const toggleEditMode = () => {
    setEditingCell(null);
    setIsEditMode((current) => !current);
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
            {module.commands.map((command) => {
              const disabled =
                runningCommand !== null ||
                (command.needsSelection && selectedIds.size === 0);
              return (
                <Button
                  key={command.label}
                  type="button"
                  variant={command.tone === "primary" ? "default" : "outline"}
                  className={commandClass(command.tone)}
                  disabled={disabled}
                  onClick={() => runCommand(command)}
                >
                  {runningCommand === command.label ? "…" : command.label}
                  {command.needsSelection && selectedIds.size > 0
                    ? ` (${selectedIds.size})`
                    : ""}
                </Button>
              );
            })}
            <Button
              type="button"
              variant={isEditMode ? "default" : "outline"}
              onClick={toggleEditMode}
              className={isEditMode ? "bg-ink-900 text-canvas hover:bg-walnut" : ""}
            >
              {isEditMode ? (
                <Lock className="size-4" aria-hidden />
              ) : (
                <Pencil className="size-4" aria-hidden />
              )}
              {isEditMode ? "Završi uređivanje" : "Uredi"}
            </Button>
            <Button type="button" variant="outline" onClick={exportCsv}>
              <Download className="size-4" aria-hidden />
              Excel
            </Button>
            {savedCellCount ? (
              <Button type="button" variant="outline" onClick={refreshRows}>
                <RotateCcw className="size-4" aria-hidden />
                Osveži podatke
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {saveError ? (
        <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {saveError}
        </div>
      ) : null}

      {commandMessage ? (
        <div
          role={commandMessage.ok ? "status" : "alert"}
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            commandMessage.ok
              ? "border-success/20 bg-success/10 text-success"
              : "border-danger/20 bg-danger/10 text-danger",
          )}
        >
          {commandMessage.text}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 rounded-2xl border border-border/60 bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <p className="text-sm text-ink-500">
              {filteredRows.length} redova · {visible.length} vidljivih kolona
              {savedCellCount ? ` · ${savedCellCount} snimljenih izmena` : ""}
              {isEditMode ? " · uređivanje uključeno" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={saveView}>
                <Save className="size-4" aria-hidden />
                Snimi pogled
              </Button>
              <Button type="button" variant="outline" onClick={resetColumns}>
                Reset kolona
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted-bg/70 text-xs uppercase tracking-[0.12em] text-ink-500">
                <tr>
                  <th className="w-10 px-3 py-3 text-center">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Izaberi sve redove"
                    />
                  </th>
                  {module.detailHrefBase ? <th className="w-16 px-3 py-3" /> : null}
                  {visible.map((column) => (
                    <th
                      key={column.key}
                      draggable
                      onDragStart={() => setDraggedColumn(column.key)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedColumn) moveColumn(draggedColumn, column.key);
                        setDraggedColumn(null);
                      }}
                      onDragEnd={() => setDraggedColumn(null)}
                      className={cn(
                        "group whitespace-nowrap px-3 py-3 text-left font-medium transition",
                        draggedColumn === column.key && "opacity-40",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-2",
                          column.align === "right" && "justify-end",
                          column.align === "center" && "justify-center",
                        )}
                      >
                        <GripVertical
                          className="size-3.5 cursor-grab text-ink-300 opacity-0 transition group-hover:opacity-100"
                          aria-hidden
                        />
                        {column.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "hover:bg-muted-bg/30",
                      selectedIds.has(row.id) && "bg-brand-blue-50/40",
                    )}
                  >
                    <td className="px-3 py-2 text-center">
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                        aria-label={`Izaberi red ${row.id}`}
                      />
                    </td>
                    {module.detailHrefBase ? (
                      <td className="px-3 py-2">
                        <Link
                          href={`${module.detailHrefBase}/${row.id}`}
                          className="text-xs text-walnut hover:underline"
                        >
                          Otvori
                        </Link>
                      </td>
                    ) : null}
                    {visible.map((column) => {
                      const value = row.values[column.key];
                      const selectOptions = getSelectOptions(column, value);
                      const isEditing =
                        editingCell?.rowId === row.id && editingCell.columnKey === column.key;
                      const originalValue = module.rows.find((item) => item.id === row.id)?.values[
                        column.key
                      ] ?? null;
                      const isSaving =
                        savingCell?.rowId === row.id && savingCell.columnKey === column.key;
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-ink-700",
                            isSaving && "bg-warning/5",
                            column.align === "right" && "text-right tabular-nums",
                            column.align === "center" && "text-center",
                          )}
                        >
                          {column.type === "boolean" ? (
                            <label className="inline-flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={Boolean(value)}
                                disabled={!isEditMode || Boolean(savingCell)}
                                onChange={(event) =>
                                  commitCell(row, column, event.target.checked)
                                }
                                className="size-4 rounded border-input accent-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`${column.label} ${row.id}`}
                              />
                            </label>
                          ) : isEditing && selectOptions.length ? (
                            <select
                              autoFocus
                              value={textValue(value)}
                              onChange={(event) =>
                                commitCell(row, column, event.target.value || null)
                              }
                              onBlur={() => setEditingCell(null)}
                              className={cn(
                                "h-8 min-w-36 rounded-md border border-ring bg-surface px-2 text-sm outline-none ring-2 ring-ring/15",
                                column.align === "right" && "text-right tabular-nums",
                                column.align === "center" && "text-center",
                              )}
                              aria-label={`Izmeni ${column.label}`}
                            >
                              <option value="">—</option>
                              {selectOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : isEditing ? (
                            <input
                              autoFocus
                              type={inputType(column)}
                              step={column.type === "number" || column.type === "money" ? "any" : undefined}
                              defaultValue={textValue(value)}
                              onBlur={(event) =>
                                commitCell(
                                  row,
                                  column,
                                  parseCellValue(event.target.value, column, value),
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  commitCell(
                                    row,
                                    column,
                                    parseCellValue(event.currentTarget.value, column, value),
                                  );
                                }
                                if (event.key === "Escape") setEditingCell(null);
                              }}
                              className={cn(
                                "h-8 min-w-32 rounded-md border border-ring bg-surface px-2 text-sm outline-none ring-2 ring-ring/15",
                                column.align === "right" && "text-right tabular-nums",
                                column.align === "center" && "text-center",
                              )}
                              aria-label={`Izmeni ${column.label}`}
                            />
                          ) : column.type === "status" ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                isEditMode &&
                                setEditingCell({ rowId: row.id, columnKey: column.key })
                              }
                              onKeyDown={(event) => {
                                if (isEditMode && (event.key === "Enter" || event.key === " ")) {
                                  setEditingCell({ rowId: row.id, columnKey: column.key });
                                }
                              }}
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                                isEditMode && "cursor-text",
                                statusClass(value),
                              )}
                              title={
                                isEditMode
                                  ? `Klik za izmenu. Original: ${formatValue(originalValue, column)}`
                                  : "Kliknite Uredi da biste menjali podatke"
                              }
                            >
                              {formatValue(value, column)}
                            </span>
                          ) : column.key === "photo" ? (
                            <button
                              type="button"
                              onClick={() =>
                                isEditMode &&
                                setEditingCell({ rowId: row.id, columnKey: column.key })
                              }
                              disabled={!isEditMode || Boolean(savingCell)}
                              className="inline-flex size-8 items-center justify-center rounded-md bg-muted-bg text-[10px] text-ink-500 ring-1 ring-border/60 transition hover:bg-surface hover:text-ink-900 disabled:cursor-default disabled:hover:bg-muted-bg disabled:hover:text-ink-500"
                              title={
                                isEditMode
                                  ? `Klik za izmenu. Original: ${formatValue(originalValue, column)}`
                                  : "Kliknite Uredi da biste menjali podatke"
                              }
                            >
                              IMG
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                isEditMode &&
                                setEditingCell({ rowId: row.id, columnKey: column.key })
                              }
                              disabled={!isEditMode || Boolean(savingCell)}
                              className={cn(
                                "group inline-flex min-h-8 max-w-[360px] items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-muted-bg",
                                !isEditMode && "cursor-default hover:bg-transparent",
                                column.align === "right" && "justify-end text-right tabular-nums",
                                column.align === "center" && "justify-center text-center",
                              )}
                              title={
                                isEditMode
                                  ? `Klik za izmenu. Original: ${formatValue(originalValue, column)}`
                                  : "Kliknite Uredi da biste menjali podatke"
                              }
                            >
                              <span className="truncate">{formatValue(value, column)}</span>
                              {isEditMode ? (
                                <Pencil
                                  className="size-3 text-ink-300 opacity-0 transition group-hover:opacity-100"
                                  aria-hidden
                                />
                              ) : null}
                            </button>
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
              {columnOrder
                .map((key) => module.columns.find((column) => column.key === key))
                .filter((column): column is ErpColumn => Boolean(column))
                .map((column) => (
                  <label
                    key={column.key}
                    draggable
                    onDragStart={() => setDraggedColumn(column.key)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedColumn) moveColumn(draggedColumn, column.key);
                      setDraggedColumn(null);
                    }}
                    onDragEnd={() => setDraggedColumn(null)}
                    className={cn(
                      "flex cursor-grab items-center gap-2 rounded-lg px-1 py-1 text-sm text-ink-700 transition hover:bg-muted-bg",
                      draggedColumn === column.key && "opacity-40",
                    )}
                  >
                    <GripVertical className="size-3.5 text-ink-300" aria-hidden />
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
