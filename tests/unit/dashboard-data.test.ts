import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.query } }));
import { buildDashboardDataQuery, getDashboardData } from "@/lib/admin/dashboard-data";
import { resolveReportPeriod } from "@/lib/admin/report-period";
const now = new Date("2026-09-19T20:00:00Z");
const todayPeriod = resolveReportPeriod({ range: "today" }, now);
const period = resolveReportPeriod({ range: "30d" }, now);
const input = { now, warehouseId: "", todayPeriod, ordersPeriod: period, fiscalPeriod: period, reclamationsPeriod: period, topProductsPeriod: period, analyticsPeriod: period };
beforeEach(() => vi.clearAllMocks());
describe("dashboard data snapshot", () => {
  it("fetches every dashboard group in a single fresh database statement", async () => {
    const data = { orderSummary: { today_count: 5 }, reclamationCount: 2, fiscalRows: [], topProducts: [], warehouseStockRows: [], incomingRows: [], visitRows: [], conversionRows: [], lowStock: [] };
    mocks.query.mockResolvedValue([data]);
    expect(await getDashboardData(input)).toBe(data);
    await getDashboardData(input);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const statement = mocks.query.mock.calls[0][0];
    expect(statement.text).toContain('AS "orderSummary"');
    expect(statement.text).toContain('AS "conversionRows"');
    expect(statement.text).toContain('AS "lowStock"');
  });
  it("binds warehouse input and dates instead of interpolating them into SQL", () => {
    const warehouseId = "warehouse'; SELECT 1; --";
    const query = buildDashboardDataQuery({ ...input, warehouseId });
    expect(query.text).not.toContain(warehouseId);
    expect(query.values).toContain(warehouseId);
    expect(query.values).toContain(todayPeriod.start);
    expect(query.text).toContain('EXISTS (SELECT 1 FROM "OrderItem"');
    expect(query.text).toContain('AND r."warehouseId" =');
    expect(query.text).not.toMatch(/generate_series/);
  });
  it("excludes cancelled orders, includes Ananas without duplicates, retains fiscal refunds and the 30-day zero-day divisor", () => {
    const { text } = buildDashboardDataQuery(input);
    const orderSummary = text.slice(0, text.indexOf('AS "orderSummary"'));
    expect(orderSummary).toContain("OTKAZANO");
    expect(orderSummary).toContain("Otkazano");
    expect(orderSummary).toContain('FROM "AnanasOrder"');
    expect(orderSummary).toContain('COALESCE(o."externalOrderNo", o.number)');
    expect(orderSummary).toContain('UNION ALL');
    expect(text).toContain('THEN f."totalGross" ELSE -f."totalGross" END');
    expect(text).toContain("/ 30.0");
    expect(text).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'");
  });
  it("propagates failures instead of presenting false zero totals", async () => {
    mocks.query.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(getDashboardData(input)).rejects.toThrow("Database unavailable");
    mocks.query.mockResolvedValueOnce([]);
    await expect(getDashboardData(input)).rejects.toThrow("Podaci kontrolne table nisu učitani.");
  });
});

it("keeps analytics scans out of the operational query and operational tables out of analytics", () => {
  const operations = buildDashboardDataQuery(input, "operations");
  const analytics = buildDashboardDataQuery(input, "analytics");
  expect(operations.text).not.toContain('"AnalyticsEvent"');
  expect(operations.text).toContain('AS "orderSummary"');
  expect(operations.text).toContain('AS "lowStock"');
  expect(analytics.text).toContain('AS "visitRows"');
  expect(analytics.text).toContain('AS "conversionRows"');
  expect(analytics.text).not.toContain('FROM "Order"');
  expect(analytics.text).not.toContain('FROM "Warehouse"');
});

it("uses reclamation dates for both quantities and delivery dates instead of order creation", () => {
  const reclamationsPeriod = resolveReportPeriod({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, now);
  const query = buildDashboardDataQuery({ ...input, reclamationsPeriod, warehouseId: "dc" }, "operations");
  const quantitySql = query.text.split('AS "reclamationCount",')[1].split('AS "reclamationDeliveredQuantity"')[0];
  const dates = [...quantitySql.matchAll(/\$(\d+)/g)].map((match) => query.values[Number(match[1]) - 1]);
  expect(dates).toEqual([
    reclamationsPeriod.start, reclamationsPeriod.endExclusive, "dc",
    reclamationsPeriod.start, reclamationsPeriod.endExclusive, "dc",
  ]);
  expect(quantitySql).toContain('SUM(r.quantity)');
  expect(quantitySql).toContain('SUM(oi.qty)');
  expect(quantitySql).toContain('AND r."warehouseId" =');
  expect(quantitySql).toContain('AND oi."warehouseId" =');
  expect(quantitySql).toContain('delivery."deliveredAt" >=');
  expect(quantitySql).toContain('delivery."deliveredAt" <');
  expect(quantitySql).not.toContain('o."createdAt"');
  expect(quantitySql).not.toContain('o."updatedAt"');
  expect(quantitySql).toContain("o.status = 'ISPORUCENO'");
  expect(quantitySql).toContain("s.purpose = 'ORDER_DELIVERY'");
  expect(quantitySql).toContain('MAX(s."deliveredAt")');
  expect(quantitySql).toContain('MIN(e."createdAt")');
});
