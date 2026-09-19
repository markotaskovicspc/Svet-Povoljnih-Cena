import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), cacheOptions: null as unknown }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown, key: unknown, options: unknown) => { mocks.cacheOptions = { key, options }; return fn; } }));
vi.mock("@/lib/admin/dashboard-data", () => ({ getDashboardAnalyticsData: mocks.load }));
import { dashboardAnalyticsCacheArgs, getDashboardAnalytics } from "@/lib/admin/dashboard-analytics";
import { resolveReportPeriod } from "@/lib/admin/report-period";
const now = new Date("2026-09-19T22:00:01Z");
const today = resolveReportPeriod({ range: "today" }, now);
const period = resolveReportPeriod({ range: "30d" }, now);
const input = { now, warehouseId: "w1", todayPeriod: today, ordersPeriod: today, fiscalPeriod: today, reclamationsPeriod: today, topProductsPeriod: today, analyticsPeriod: period };
afterEach(() => vi.useRealTimers());
describe("dashboard analytics freshness", () => {
  it("reuses a period within a window and always rotates the key after 30 seconds", () => {
    const key = dashboardAnalyticsCacheArgs(input);
    expect(dashboardAnalyticsCacheArgs({ ...input, now: new Date("2026-09-19T22:00:29Z") })).toEqual(key);
    expect(dashboardAnalyticsCacheArgs({ ...input, now: new Date("2026-09-19T22:00:30Z") })).not.toEqual(key);
    expect(dashboardAnalyticsCacheArgs({ ...input, now: new Date("2026-09-20T22:00:01Z") })).not.toEqual(key);
  });
  it("separates different periods while retaining the existing warehouse-independent analytics", () => {
    expect(dashboardAnalyticsCacheArgs({ ...input, warehouseId: "other" })).toEqual(dashboardAnalyticsCacheArgs(input));
    expect(dashboardAnalyticsCacheArgs({ ...input, analyticsPeriod: today })).not.toEqual(dashboardAnalyticsCacheArgs(input));
  });
  it("returns its snapshot timestamp and keeps Belgrade midnight boundaries", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    mocks.load.mockResolvedValue({ visitRows: [{ today: 2 }], conversionRows: [] });
    const result = await getDashboardAnalytics(input);
    expect(result.checkedAt).toBe("2026-09-19T22:00:00.000Z");
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({
      now: new Date("2026-09-19T22:00:00.000Z"), warehouseId: "", todayPeriod: expect.objectContaining({ fromInput: "2026-09-20" }),
      analyticsPeriod: expect.objectContaining({ start: period.start, endExclusive: period.endExclusive }),
    }));
    expect(mocks.cacheOptions).toEqual({ key: ["admin-dashboard-analytics-v1"], options: { revalidate: 30 } });
  });
  it("does not turn a database failure into zero-valued analytics", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(getDashboardAnalytics(input)).rejects.toThrow("Database unavailable");
  });
});

it("does not switch the request's day if a cache miss executes after midnight", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T22:00:01Z"));
  mocks.load.mockResolvedValue({ visitRows: [], conversionRows: [] });
  await getDashboardAnalytics({ ...input, now: new Date("2026-09-19T21:59:59Z") });
  expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({
    todayPeriod: expect.objectContaining({ fromInput: "2026-09-19" }),
  }));
});
