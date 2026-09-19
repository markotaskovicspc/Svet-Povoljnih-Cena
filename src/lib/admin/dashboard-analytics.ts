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
    // Anchor relative periods to this request window, including midnight/DST.
    const now = new Date(window * DASHBOARD_ANALYTICS_WINDOW_MS);
    const today = resolveReportPeriod({ range: "today" }, now);
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
  ["admin-dashboard-analytics-v1"],
  { revalidate: 30 },
);

// Only aggregate analytics is shared. The rotating key prevents an old window
// being served on the first visit after a long idle period. Operations and
// authorization are never cached here. The page authorizes before calling us.
export function getDashboardAnalytics(input: DashboardDataInput) {
  return readAnalytics(...dashboardAnalyticsCacheArgs(input));
}
