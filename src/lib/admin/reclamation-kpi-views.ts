import type { AdminGridFilter, AdminGridSort } from "@/lib/admin/erp";

export const RECLAMATION_JOURNAL_PATH = "/admin/erp/reklamacije-dnevnik";
const DAY_MS = 24 * 60 * 60 * 1000;
export const RECLAMATION_AGE_DAYS = [5, 10, 20, 30] as const;

export type ReclamationKpiView = "sve" | "resene" | "neresene" | "neobradjene" | `starije-${(typeof RECLAMATION_AGE_DAYS)[number]}`;

export function reclamationKpiHref(view: ReclamationKpiView) {
  return view === "sve" ? RECLAMATION_JOURNAL_PATH : `${RECLAMATION_JOURNAL_PATH}?prikaz=${view}`;
}

const filter = (id: string, columnKey: string, operator: AdminGridFilter["operator"], value: string): AdminGridFilter =>
  ({ id: `kpi-${id}`, columnKey, operator, value });

const OPEN: AdminGridFilter[] = [
  filter("not-resolved", "status", "not_equals", "RESENO"),
  filter("not-rejected", "status", "not_equals", "ODBIJENO"),
];

/** Filteri koji daju iste redove kao brojevi u zaglavlju (reclamation-analytics: zatvorene = REŠENO i ODBIJENO). */
export function reclamationKpiFilters(view: string | undefined, now = new Date()): { filters: AdminGridFilter[]; sorting: AdminGridSort[] } | null {
  if (view === "resene") {
    return {
      filters: [
        filter("not-received", "status", "not_equals", "PRIMLJENO"),
        filter("not-processing", "status", "not_equals", "U_OBRADI"),
      ],
      sorting: [],
    };
  }
  if (view === "neresene") return { filters: OPEN, sorting: [] };
  if (view === "neobradjene") return { filters: [filter("untasked", "untasked", "equals", "Bez naloga")], sorting: [] };
  const age = /^starije-(\d+)$/.exec(view ?? "");
  if (age && (RECLAMATION_AGE_DAYS as readonly number[]).includes(Number(age[1]))) {
    const cutoff = new Date(now.getTime() - Number(age[1]) * DAY_MS).toISOString();
    return {
      filters: [...OPEN, filter("older", "createdAt", "before", cutoff)],
      sorting: [{ columnKey: "createdAt", direction: "asc" }],
    };
  }
  return null;
}
