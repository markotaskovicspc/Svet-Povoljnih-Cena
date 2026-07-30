import {
  REPORT_PERIOD_PRESETS,
  resolveReportPeriod,
  type ReportPeriod,
  type ReportPeriodPreset,
} from "@/lib/admin/report-period";

export const DASHBOARD_PERIOD_NAMES = [
  "orders",
  "fiscal",
  "reclamations",
  "topProducts",
] as const;

export type DashboardPeriodName = (typeof DASHBOARD_PERIOD_NAMES)[number];
export type DashboardPeriodRange = ReportPeriodPreset | "custom";

export const DASHBOARD_PERIOD_RANGES = [
  ...REPORT_PERIOD_PRESETS.map((preset) => preset.key),
  "custom",
] as const satisfies readonly DashboardPeriodRange[];

export type DashboardFilterContext = {
  warehouseId: string;
  ordersRange: DashboardPeriodRange;
  ordersFrom: string;
  ordersTo: string;
  fiscalRange: DashboardPeriodRange;
  fiscalFrom: string;
  fiscalTo: string;
  reclamationsRange: DashboardPeriodRange;
  reclamationsFrom: string;
  reclamationsTo: string;
  topProductsRange: DashboardPeriodRange;
  topProductsFrom: string;
  topProductsTo: string;
};

export type DashboardFilterParams = Partial<DashboardFilterContext>;

export const DASHBOARD_CONTEXT_KEYS = [
  "warehouseId",
  "ordersRange",
  "ordersFrom",
  "ordersTo",
  "fiscalRange",
  "fiscalFrom",
  "fiscalTo",
  "reclamationsRange",
  "reclamationsFrom",
  "reclamationsTo",
  "topProductsRange",
  "topProductsFrom",
  "topProductsTo",
] as const satisfies readonly (keyof DashboardFilterContext)[];

export type ResolvedDashboardFilters = {
  context: DashboardFilterContext;
  periods: Record<DashboardPeriodName, ReportPeriod>;
};

export function cleanDashboardContext(value: unknown): DashboardFilterParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    DASHBOARD_CONTEXT_KEYS.flatMap((key) => {
      const item = source[key];
      return isDashboardContextEntry(key, item) ? [[key, item]] : [];
    }),
  ) as DashboardFilterParams;
}

export function isDashboardContextEntry(
  key: string,
  value: unknown,
): value is string {
  if (
    !DASHBOARD_CONTEXT_KEYS.includes(key as keyof DashboardFilterContext) ||
    typeof value !== "string" ||
    value.length > 120
  ) {
    return false;
  }
  if (key.endsWith("Range")) {
    return DASHBOARD_PERIOD_RANGES.includes(value as DashboardPeriodRange);
  }
  if (key.endsWith("From") || key.endsWith("To")) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
  return true;
}

export function dashboardContextFromSavedColumns(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return cleanDashboardContext((value as Record<string, unknown>).context);
}

export function hasDashboardContext(value: unknown) {
  return Object.keys(cleanDashboardContext(value)).length > 0;
}

export function resolveDashboardFilters(
  raw: DashboardFilterParams,
  now = new Date(),
): ResolvedDashboardFilters {
  const periods = Object.fromEntries(
    DASHBOARD_PERIOD_NAMES.map((name) => {
      const rangeKey = `${name}Range` as const;
      const fromKey = `${name}From` as const;
      const toKey = `${name}To` as const;
      const legacyCustom = !raw[rangeKey] && raw[fromKey] && raw[toKey];
      return [
        name,
        resolveReportPeriod(
          {
            range: legacyCustom ? "custom" : raw[rangeKey],
            from: raw[fromKey],
            to: raw[toKey],
          },
          now,
        ),
      ];
    }),
  ) as Record<DashboardPeriodName, ReportPeriod>;

  return {
    periods,
    context: {
      warehouseId: raw.warehouseId ?? "",
      ordersRange: periods.orders.preset,
      ordersFrom: periods.orders.fromInput,
      ordersTo: periods.orders.toInput,
      fiscalRange: periods.fiscal.preset,
      fiscalFrom: periods.fiscal.fromInput,
      fiscalTo: periods.fiscal.toInput,
      reclamationsRange: periods.reclamations.preset,
      reclamationsFrom: periods.reclamations.fromInput,
      reclamationsTo: periods.reclamations.toInput,
      topProductsRange: periods.topProducts.preset,
      topProductsFrom: periods.topProducts.fromInput,
      topProductsTo: periods.topProducts.toInput,
    },
  };
}
