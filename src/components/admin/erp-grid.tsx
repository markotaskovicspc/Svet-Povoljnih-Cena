"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  AdminGridFilter,
  AdminGridSort,
  ErpColumn,
  ErpCommand,
  ErpModule,
  ErpRow,
  ErpValue,
} from "@/lib/admin/erp";

type SavedView = {
  id?: string;
  name: string;
  visibleColumns: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  filters: AdminGridFilter[];
  sorting: AdminGridSort[];
  query: string;
  context?: Record<string, string>;
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

function localDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const FILTER_OPERATOR_LABELS: Record<AdminGridFilter["operator"], string> = {
  contains: "sadrži",
  equals: "jednako",
  not_equals: "nije jednako",
  gt: "veće od",
  gte: "veće ili jednako",
  lt: "manje od",
  lte: "manje ili jednako",
  before: "pre",
  after: "posle",
};

function operatorsFor(column: ErpColumn): AdminGridFilter["operator"][] {
  if (column.type === "number" || column.type === "money") {
    return ["equals", "not_equals", "gt", "gte", "lt", "lte"];
  }
  if (column.type === "date") {
    return ["equals", "before", "after"];
  }
  if (column.type === "status" || column.type === "boolean" || column.options?.length) {
    return ["equals", "not_equals"];
  }
  return ["contains", "equals", "not_equals"];
}

function matchesFilter(value: ErpValue, filter: AdminGridFilter) {
  const actualText = textValue(value).trim().toLowerCase();
  const expectedText = filter.value.trim().toLowerCase();
  if (!expectedText) return true;
  const actualNumber = Number(actualText.replace(",", "."));
  const expectedNumber = Number(expectedText.replace(",", "."));
  switch (filter.operator) {
    case "contains":
      return actualText.includes(expectedText);
    case "equals":
      return actualText === expectedText;
    case "not_equals":
      return actualText !== expectedText;
    case "gt":
      return actualNumber > expectedNumber;
    case "gte":
      return actualNumber >= expectedNumber;
    case "lt":
      return actualNumber < expectedNumber;
    case "lte":
      return actualNumber <= expectedNumber;
    case "before":
      return new Date(actualText).getTime() < new Date(expectedText).getTime();
    case "after":
      return new Date(actualText).getTime() > new Date(expectedText).getTime();
  }
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
  const [filters, setFilters] = useState<AdminGridFilter[]>([]);
  const [sorting, setSorting] = useState<AdminGridSort[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultColumns);
  const [cellEdits, setCellEdits] = useState<Record<string, Record<string, ErpValue>>>({});
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    readColumnOrder(module.slug, module.columns),
  );
  const [views, setViews] = useState<SavedView[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
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
  const [activeCommand, setActiveCommand] = useState<ErpCommand | null>(null);
  const [commandInput, setCommandInput] = useState<Record<string, string>>({});
  const [commandFormError, setCommandFormError] = useState<string | null>(null);
  const [serverRows, setServerRows] = useState<ErpRow[]>(module.rows);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [totalRows, setTotalRows] = useState(module.rows.length);
  const [loadingRows, setLoadingRows] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [context, setContext] = useState<Record<string, string>>(() =>
    Object.fromEntries((module.contextFilters ?? []).map((filter) => [filter.key, ""])),
  );
  const canEditColumn = (columnKey: string) =>
    Boolean(module.editableColumns?.includes(columnKey));
  const updateQuery = (value: SetStateAction<string>) => {
    setPage(1);
    setQuery(value);
  };
  const updateFilters = (
    value: SetStateAction<AdminGridFilter[]>,
  ) => {
    setPage(1);
    setFilters(value);
  };
  const updateSorting = (
    value: SetStateAction<AdminGridSort[]>,
  ) => {
    setPage(1);
    setSorting(value);
  };
  const updateVisibleColumns = (
    value: SetStateAction<string[]>,
  ) => {
    setPage(1);
    setVisibleColumns(value);
  };

  useEffect(() => {
    let cancelled = false;
    const localViews = readViews(module.slug);
    fetch(`/api/admin/saved-views?module=${encodeURIComponent(module.slug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Pogledi nisu učitani.");
        return response.json() as Promise<{ views?: SavedView[] }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setViews(payload.views?.length ? payload.views : localViews);
        }
      })
      .catch(() => {
        if (!cancelled) setViews(localViews);
      });
    return () => {
      cancelled = true;
    };
  }, [module.slug]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingRows(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "100",
          q: query,
          filters: JSON.stringify(filters),
          sorting: JSON.stringify(sorting),
          columns: JSON.stringify(visibleColumns),
          ...context,
        });
        const response = await fetch(
          `/api/admin/erp/${encodeURIComponent(module.slug)}/rows?${params}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              rows?: ErpRow[];
              page?: number;
              pageCount?: number;
              total?: number;
              error?: string;
            }
          | null;
        if (!response.ok || !payload?.rows) {
          throw new Error(payload?.error ?? "Redovi nisu učitani.");
        }
        setServerRows(payload.rows);
        setPageCount(payload.pageCount ?? 1);
        setTotalRows(payload.total ?? payload.rows.length);
        const loadedIds = new Set(payload.rows.map((row) => row.id));
        setSelectedIds(
          (current) =>
            new Set(Array.from(current).filter((id) => loadedIds.has(id))),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCommandMessage({
          ok: false,
          text: error instanceof Error ? error.message : "Redovi nisu učitani.",
        });
      } finally {
        if (!controller.signal.aborted) setLoadingRows(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    filters,
    module.slug,
    page,
    query,
    reloadToken,
    sorting,
    visibleColumns,
    context,
  ]);

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
      serverRows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          ...(cellEdits[row.id] ?? {}),
        },
      })),
    [cellEdits, serverRows],
  );

  const getSelectOptions = (column: ErpColumn, currentValue: ErpValue) => {
    if (!column.options && column.type !== "status") return [];
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
    const filtered = rows.filter((row) => {
      if (q) {
        const hay = visible
          .map((c) => textValue(row.values[c.key]))
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return filters.every((filter) => {
        return matchesFilter(row.values[filter.columnKey], filter);
      });
    });
    if (!sorting.length) return filtered;
    return [...filtered].sort((a, b) => {
      for (const sort of sorting) {
        const left = a.values[sort.columnKey];
        const right = b.values[sort.columnKey];
        const leftNumber = typeof left === "number" ? left : Number.NaN;
        const rightNumber = typeof right === "number" ? right : Number.NaN;
        const comparison =
          Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
            ? leftNumber - rightNumber
            : textValue(left).localeCompare(textValue(right), "sr-Latn");
        if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
      }
      return 0;
    });
  }, [filters, query, rows, sorting, visible]);

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

  const closeCommandForm = () => {
    setActiveCommand(null);
    setCommandInput({});
    setCommandFormError(null);
  };

  const runCommand = async (
    command: ErpCommand,
    input?: Record<string, string>,
  ) => {
    if (command.href) {
      router.push(command.href);
      return;
    }
    if (command.clientAction === "edit") {
      setEditingCell(null);
      setIsEditMode((current) => !current);
      setCommandMessage(null);
      return;
    }
    if (command.fields?.length && !input) {
      setActiveCommand(command);
      setCommandInput(
        Object.fromEntries(
          command.fields.map((field) => [
            field.key,
            field.key === "validFrom" && field.type === "date"
              ? localDateValue()
              : "",
          ]),
        ),
      );
      setCommandFormError(null);
      setCommandMessage(null);
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
          body: JSON.stringify({ action: command.action, ids, input }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            error?: string;
            redirect?: string;
            createdId?: string;
          }
        | null;
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Komanda nije izvršena.");
      }
      setSelectedIds(payload.createdId ? new Set([payload.createdId]) : new Set());
      if (payload.redirect) {
        router.push(payload.redirect);
        return;
      }
      if (
        payload.createdId &&
        (module.slug === "dobavljaci" || module.slug === "nabavne-cene")
      ) {
        setIsEditMode(true);
      }
      closeCommandForm();
      setCommandMessage({ ok: true, text: payload.message ?? "Urađeno." });
      setReloadToken((token) => token + 1);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Komanda nije izvršena.";
      setCommandMessage({
        ok: false,
        text: message,
      });
      if (input) setCommandFormError(message);
    } finally {
      setRunningCommand(null);
    }
  };

  const submitCommandForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeCommand) return;
    void runCommand(activeCommand, commandInput);
  };

  const addFilter = () => {
    if (!newFilterColumn) return;
    const column = module.columns.find((item) => item.key === newFilterColumn);
    updateFilters((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        columnKey: newFilterColumn,
        operator: column ? operatorsFor(column)[0] : "contains",
        value: "",
      },
    ]);
  };

  const toggleColumn = (key: string) => {
    updateVisibleColumns((current) =>
      current.includes(key)
        ? current.filter((c) => c !== key)
        : [...current, key],
    );
  };

  const saveView = async () => {
    const name = window.prompt("Naziv pogleda");
    if (!name?.trim()) return;
    const view: SavedView = {
      name: name.trim(),
      visibleColumns,
      columnOrder,
      columnWidths,
      filters,
      sorting,
      query,
      context,
    };
    try {
      const response = await fetch("/api/admin/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module: module.slug, ...view }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { view?: SavedView; error?: string }
        | null;
      if (!response.ok || !payload?.view) {
        throw new Error(payload?.error ?? "Pogled nije snimljen.");
      }
      setViews((current) => [
        ...current.filter((item) => item.name !== view.name),
        payload.view!,
      ]);
      writeViews(module.slug, [
        ...views.filter((item) => item.name !== view.name),
        payload.view,
      ]);
      setCommandMessage({ ok: true, text: `Pogled „${view.name}” je snimljen u bazu.` });
    } catch (error) {
      setCommandMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Pogled nije snimljen.",
      });
    }
  };

  const applyView = (view: SavedView) => {
    updateVisibleColumns(view.visibleColumns);
    if (view.columnOrder?.length) {
      setColumnOrder(view.columnOrder);
      writeColumnOrder(module.slug, view.columnOrder);
    }
    setColumnWidths(view.columnWidths ?? {});
    updateFilters(
      view.filters.map((filter) => ({
        ...filter,
        operator: filter.operator ?? "contains",
      })),
    );
    updateSorting(view.sorting ?? []);
    updateQuery(view.query);
    setContext((current) => ({ ...current, ...(view.context ?? {}) }));
  };

  const commitCell = async (row: ErpRow, column: ErpColumn, value: ErpValue) => {
    if (!isEditMode || !canEditColumn(column.key)) return;
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
      const payload = (await res.json().catch(() => null)) as
        | {
            error?: string;
            value?: ErpValue;
            refreshRow?: boolean;
          }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? "ERP izmena nije snimljena.");
      }
      if (payload && "value" in payload) {
        setCellEdits((current) => ({
          ...current,
          [row.id]: {
            ...(current[row.id] ?? {}),
            [column.key]: payload.value ?? null,
          },
        }));
      }
      if (payload?.refreshRow) {
        setCellEdits((current) => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
        setReloadToken((token) => token + 1);
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
    setReloadToken((token) => token + 1);
    router.refresh();
  };

  const resetColumns = () => {
    const defaultOrder = module.columns.map((column) => column.key);
    updateVisibleColumns(defaultColumns);
    setColumnOrder(defaultOrder);
    setColumnWidths({});
    updateSorting([]);
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

  const toggleSort = (columnKey: string) => {
    updateSorting((current) => {
      const existing = current.find((item) => item.columnKey === columnKey);
      if (!existing) return [{ columnKey, direction: "asc" }];
      if (existing.direction === "asc") return [{ columnKey, direction: "desc" }];
      return [];
    });
  };

  const startResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    columnKey: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[columnKey] ?? 160;
    const onMove = (moveEvent: PointerEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [columnKey]: Math.max(88, Math.min(520, startWidth + moveEvent.clientX - startX)),
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const exportXlsx = () => {
    const params = new URLSearchParams({
      q: query,
      filters: JSON.stringify(filters),
      sorting: JSON.stringify(sorting),
      columns: JSON.stringify(visible.map((column) => column.key)),
      ...context,
    });
    const a = document.createElement("a");
    a.href = `/api/admin/erp/${encodeURIComponent(module.slug)}/export?${params}`;
    a.download = `${module.slug}.xlsx`;
    a.click();
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
                  onChange={(e) => updateQuery(e.target.value)}
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

            {module.contextFilters?.length ? (
              <div className="flex flex-wrap gap-3">
                {module.contextFilters.map((filter) => (
                  <label
                    key={filter.key}
                    className="flex items-center gap-2 text-sm text-ink-600"
                  >
                    <span>{filter.label}</span>
                    <select
                      value={context[filter.key] ?? ""}
                      onChange={(event) => {
                        setPage(1);
                        setContext((current) => ({
                          ...current,
                          [filter.key]: event.target.value,
                        }));
                      }}
                      className="h-9 min-w-56 rounded-lg border border-input bg-surface px-2 text-sm text-ink-900"
                      aria-label={filter.label}
                    >
                      {filter.options.map((option) => (
                        <option key={option.value || "all"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}

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
                      <select
                        value={filter.operator}
                        onChange={(event) =>
                          updateFilters((current) =>
                            current.map((item) =>
                              item.id === filter.id
                                ? {
                                    ...item,
                                    operator:
                                      event.target.value as AdminGridFilter["operator"],
                                  }
                                : item,
                            ),
                          )
                        }
                        className="h-7 rounded-md border border-input bg-surface px-1 text-xs"
                        aria-label={`Operator ${column?.label ?? filter.columnKey}`}
                      >
                        {(
                          column
                            ? operatorsFor(column)
                            : (["contains"] as AdminGridFilter["operator"][])
                        ).map((operator) => (
                          <option key={operator} value={operator}>
                            {FILTER_OPERATOR_LABELS[operator]}
                          </option>
                        ))}
                      </select>
                      {column?.options?.length ? (
                        <select
                          value={filter.value}
                          onChange={(event) =>
                            updateFilters((current) =>
                              current.map((item) =>
                                item.id === filter.id
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="h-7 w-40 rounded-md border border-input bg-surface px-2 text-xs"
                          aria-label={`Filter ${column.label}`}
                        >
                          <option value="">Sve</option>
                          {column.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={inputType(column ?? { key: "", label: "" })}
                          value={filter.value}
                          onChange={(e) =>
                            updateFilters((current) =>
                              current.map((f) =>
                                f.id === filter.id ? { ...f, value: e.target.value } : f,
                              ),
                            )
                          }
                          className="h-7 w-40 rounded-md border border-input bg-surface px-2 text-xs outline-none focus:border-ring"
                          aria-label={`Filter ${column?.label ?? filter.columnKey}`}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          updateFilters((current) =>
                            current.filter((f) => f.id !== filter.id),
                          )
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
              const isEditCommand = command.clientAction === "edit";
              const disabled =
                runningCommand !== null ||
                Boolean(command.disabledReason) ||
                (command.needsSelection && selectedIds.size === 0);
              return (
                <Button
                  key={command.label}
                  type="button"
                  variant={
                    command.tone === "primary" || (isEditCommand && isEditMode)
                      ? "default"
                      : "outline"
                  }
                  className={cn(
                    commandClass(command.tone),
                    isEditCommand &&
                      isEditMode &&
                      "bg-ink-900 text-canvas hover:bg-walnut",
                  )}
                  disabled={disabled}
                  onClick={() => runCommand(command)}
                  title={command.disabledReason}
                >
                  {runningCommand === command.label
                    ? "…"
                    : isEditCommand && isEditMode
                      ? "Završi uređivanje"
                      : command.label}
                  {command.needsSelection && selectedIds.size > 0
                    ? ` (${selectedIds.size})`
                    : ""}
                </Button>
              );
            })}
            {module.editableColumns?.length &&
            !module.commands.some((command) => command.clientAction === "edit") ? (
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
                {isEditMode ? "Završi uređivanje" : "Uredi podržana polja"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={exportXlsx}>
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

      <Dialog
        open={Boolean(activeCommand)}
        onOpenChange={(open) => {
          if (!open && !runningCommand) closeCommandForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{activeCommand?.label}</DialogTitle>
            <DialogDescription>
              Unesite promenljive podatke. Dobavljač, naziv artikla, atributi,
              dezen, valuta i paritet biće automatski preuzeti iz matičnih
              podataka.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitCommandForm}>
            {activeCommand?.fields?.map((field) => {
              const id = `erp-command-${field.key}`;
              return (
                <label key={field.key} htmlFor={id} className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-800">
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  {field.options ? (
                    <select
                      id={id}
                      value={commandInput[field.key] ?? ""}
                      required={field.required}
                      disabled={Boolean(runningCommand)}
                      onChange={(event) =>
                        setCommandInput((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      className="h-9 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
                    >
                      <option value="">Izaberite artikal</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={id}
                      type={field.type}
                      value={commandInput[field.key] ?? ""}
                      required={field.required}
                      min={field.min}
                      step={field.step}
                      disabled={Boolean(runningCommand)}
                      onChange={(event) =>
                        setCommandInput((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              );
            })}
            {commandFormError ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {commandFormError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(runningCommand)}
                onClick={closeCommandForm}
              >
                Odustani
              </Button>
              <Button type="submit" disabled={Boolean(runningCommand)}>
                {runningCommand ? "Čuvanje…" : activeCommand?.label}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {saveError ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {saveError}
        </div>
      ) : null}

      {module.blockedReason ? (
        <div className="rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
          Konfiguracija je obavezna: {module.blockedReason}
        </div>
      ) : null}

      {module.commands.some((command) => command.disabledReason) ? (
        <div className="rounded-xl border border-border/60 bg-muted-bg/40 px-4 py-3 text-sm text-ink-600">
          {module.commands
            .filter((command) => command.disabledReason)
            .map((command) => (
              <p key={command.label}>
                {command.label}: {command.disabledReason}
              </p>
            ))}
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
              {loadingRows
                ? "Učitavanje…"
                : `${filteredRows.length} na strani · ${totalRows} ukupno`}
              {" · "}
              {visible.length} vidljivih kolona
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
                      style={{
                        width: columnWidths[column.key],
                        minWidth: columnWidths[column.key] ?? 120,
                      }}
                      onDragStart={() => setDraggedColumn(column.key)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedColumn) moveColumn(draggedColumn, column.key);
                        setDraggedColumn(null);
                      }}
                      onDragEnd={() => setDraggedColumn(null)}
                      className={cn(
                        "group relative whitespace-nowrap px-3 py-3 text-left font-medium transition",
                        draggedColumn === column.key && "opacity-40",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "inline-flex items-center gap-2",
                          column.align === "right" && "justify-end",
                          column.align === "center" && "justify-center",
                        )}
                        title="Sortiraj po ovoj koloni"
                      >
                        <GripVertical
                          className="size-3.5 cursor-grab text-ink-300 opacity-0 transition group-hover:opacity-100"
                          aria-hidden
                        />
                        {column.label}
                        {sorting[0]?.columnKey === column.key
                          ? sorting[0].direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : null}
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => startResize(event, column.key)}
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-walnut/30"
                        aria-label={`Promeni širinu kolone ${column.label}`}
                      />
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
                          style={{
                            width: columnWidths[column.key],
                            maxWidth: columnWidths[column.key],
                          }}
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
                                disabled={
                                  !isEditMode ||
                                  !canEditColumn(column.key) ||
                                  Boolean(savingCell)
                                }
                                onChange={(event) =>
                                  commitCell(row, column, event.target.checked)
                                }
                                className="size-4 rounded border-input accent-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`${column.label} ${row.id}`}
                              />
                            </label>
                          ) : isEditing &&
                            (column.options !== undefined || column.type === "status") ? (
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
                                canEditColumn(column.key) &&
                                setEditingCell({ rowId: row.id, columnKey: column.key })
                              }
                              onKeyDown={(event) => {
                                if (
                                  isEditMode &&
                                  canEditColumn(column.key) &&
                                  (event.key === "Enter" || event.key === " ")
                                ) {
                                  setEditingCell({ rowId: row.id, columnKey: column.key });
                                }
                              }}
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                                isEditMode && canEditColumn(column.key) && "cursor-text",
                                statusClass(value),
                              )}
                              title={
                                isEditMode && canEditColumn(column.key)
                                  ? `Klik za izmenu. Original: ${formatValue(originalValue, column)}`
                                  : "Polje je samo za čitanje"
                              }
                            >
                              {formatValue(value, column)}
                            </span>
                          ) : column.key === "photo" ? (
                            <Link
                              href={`/admin/proizvodi/${row.id}#mediji`}
                              className="inline-flex size-12 items-center justify-center overflow-hidden rounded-md bg-muted-bg text-[10px] text-ink-500 ring-1 ring-border/60 transition hover:ring-walnut/40"
                              title={value ? "Otvori fotografije artikla" : "Dodaj fotografiju"}
                            >
                              {typeof value === "string" && value ? (
                                <Image
                                  src={value}
                                  alt=""
                                  width={48}
                                  height={48}
                                  unoptimized
                                  className="size-12 object-cover"
                                />
                              ) : (
                                "+ Foto"
                              )}
                            </Link>
                          ) : [
                              "stockTotal",
                              "reservedStock",
                              "availableTotal",
                              "stockDc",
                              "availableDc",
                            ].includes(column.key) ? (
                            <Link
                              href={`/admin/erp/artikli/${row.id}/zalihe${
                                context.warehouseId
                                  ? `?warehouseId=${encodeURIComponent(context.warehouseId)}`
                                  : ""
                              }`}
                              className="inline-flex min-h-8 items-center rounded-md px-1.5 py-1 text-walnut underline-offset-2 hover:underline"
                              title="Otvori stanje i kretanje zaliha"
                            >
                              {formatValue(value, column)}
                            </Link>
                          ) : column.key === "siteDescription" ? (
                            <Link
                              href={`/admin/proizvodi/${row.id}#opis-za-sajt`}
                              className="inline-flex min-h-8 max-w-[360px] items-center rounded-md px-1.5 py-1 text-walnut underline-offset-2 hover:underline"
                              title="Otvori formatirani opis artikla"
                            >
                              <span className="truncate">{formatValue(value, column)}</span>
                            </Link>
                          ) : column.key === "benefits" || column.key === "certificates" ? (
                            <Link
                              href={`/admin/proizvodi/${row.id}#sifarnici`}
                              className="inline-flex min-h-8 max-w-[360px] items-center rounded-md px-1.5 py-1 text-walnut underline-offset-2 hover:underline"
                            >
                              <span className="truncate">{formatValue(value, column)}</span>
                            </Link>
                          ) : column.key === "siteLink" && typeof value === "string" ? (
                            <Link
                              href={value}
                              className="text-walnut underline-offset-2 hover:underline"
                            >
                              {value}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                isEditMode &&
                                canEditColumn(column.key) &&
                                setEditingCell({ rowId: row.id, columnKey: column.key })
                              }
                              disabled={
                                !isEditMode ||
                                !canEditColumn(column.key) ||
                                Boolean(savingCell)
                              }
                              className={cn(
                                "group inline-flex min-h-8 max-w-[360px] items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-muted-bg",
                                !isEditMode && "cursor-default hover:bg-transparent",
                                column.align === "right" && "justify-end text-right tabular-nums",
                                column.align === "center" && "justify-center text-center",
                              )}
                              title={
                                isEditMode && canEditColumn(column.key)
                                  ? `Klik za izmenu. Original: ${formatValue(originalValue, column)}`
                                  : "Polje je samo za čitanje"
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
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
            <p className="text-sm text-ink-500">
              Strana {page} od {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || loadingRows}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                aria-label="Prethodna strana"
              >
                <ChevronLeft className="size-4" aria-hidden />
                Prethodna
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={page >= pageCount || loadingRows}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                aria-label="Sledeća strana"
              >
                Sledeća
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
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
