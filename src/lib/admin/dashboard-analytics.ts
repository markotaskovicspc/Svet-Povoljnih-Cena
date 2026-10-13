import "server-only";
import { unstable_cache } from "next/cache";
import { getDashboardAnalyticsData, type DashboardDataInput } from "./dashboard-data";
import { resolveReportPeriod } from "./report-period";

export const DASHBOARD_ANALYTICS_WINDOW_MS = 30_000;

export function dashboardAnalyticsCacheArgs(input: DashboardDataInput) {
  return [
    Math.floor(input.now.getTime() / DASHBOARD_ANALYTICS_WINDOW_MS),
    input.analyticsPeriod.start.toISOString(),
    input.analyticsPeriod.endExclusive.toISOString(),
  ] as const;
}

const readAnalytics = unstable_cache(
  async (window: number, start: string, endExclusive: string) => {
    // Keep the request's day stable at midnight, but let a manual cache
    // invalidation include visitors who arrived within this same 30s window.
    const anchor = window * DASHBOARD_ANALYTICS_WINDOW_MS;
    const now = new Date(Math.max(anchor, Math.min(Date.now(), anchor + DASHBOARD_ANALYTICS_WINDOW_MS - 1)));
    const today = resolveReportPeriod({ range: "today" }, new Date(anchor));
    const data = await getDashboardAnalyticsData({
      now,
      warehouseId: "",
      todayPeriod: today,
      ordersPeriod: today,
      fiscalPeriod: today,
      reclamationsPeriod: today,
      topProductsPeriod: today,
      analyticsPeriod: { ...today, start: new Date(start), endExclusive: new Date(endExclusive) },
    });
    return { ...data, checkedAt: now.toISOString() };
  },
  ["admin-dashboard-analytics-v2"],
  { revalidate: 30, tags: ["admin-dashboard-analytics"] },
);

// Only aggregate analytics is shared. The rotating key prevents an old window
// being served on the first visit after a long idle period. Operations and
// authorization are never cached here. The page authorizes before calling us.
export function getDashboardAnalytics(input: DashboardDataInput) {
  return readAnalytics(...dashboardAnalyticsCacheArgs(input));
}
