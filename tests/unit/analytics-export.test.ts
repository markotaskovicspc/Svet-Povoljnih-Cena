import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  daily: vi.fn(),
  summary: vi.fn(),
  pages: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize }));
vi.mock("@/lib/admin/analytics-report.server", () => ({
  getDailyVisitsReport: mocks.daily,
  getAnalyticsFunnelSummary: mocks.summary,
  getPageConversionReport: mocks.pages,
  normalizeAnalyticsGranularity: () => "week",
}));

import { GET } from "@/app/api/admin/analytics/conversions/export/route";

beforeEach(() => {
  mocks.authorize.mockResolvedValue(undefined);
  mocks.daily.mockResolvedValue([
    { day: "2026-09-11", visits: 0, pageViews: 0 },
    { day: "2026-09-10", visits: 2, pageViews: 5 },
  ]);
  mocks.summary.mockResolvedValue({
    visitors: 2, purchasers: 0, purchaseValue: 0, cartBuyers: 0, convertedCartBuyers: 0,
  });
  mocks.pages.mockResolvedValue([]);
});

it("exports daily site totals and zero days even when page details use weekly grouping", async () => {
  const response = await GET(new Request(
    "http://localhost/api/admin/analytics/conversions/export?range=custom&from=2026-09-10&to=2026-09-11&group=week",
  ));
  expect(mocks.authorize).toHaveBeenCalledWith(["ADS"]);
  expect(mocks.daily).toHaveBeenCalledWith(expect.objectContaining({
    fromInput: "2026-09-10", toInput: "2026-09-11",
  }));
  expect(response.headers.get("content-disposition")).toContain("2026-09-10-2026-09-11.xlsx");
  expect(response.headers.get("cache-control")).toBe("private, no-store");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Posete po danu", "Sažetak", "Stranice",
  ]);
  const daily = workbook.getWorksheet("Posete po danu")!;
  expect(daily.getRow(1).values).toEqual([, "Dan", "Ukupno poseta", "Pregledi stranica"]);
  expect(daily.getRow(2).values).toEqual([, "2026-09-11", 0, 0]);
  expect(daily.getRow(3).values).toEqual([, "2026-09-10", 2, 5]);
});

it("does not read analytics or export when authorization fails", async () => {
  mocks.authorize.mockRejectedValueOnce(new Error("Forbidden"));
  await expect(GET(new Request("http://localhost/api/admin/analytics/conversions/export")))
    .rejects.toThrow("Forbidden");
  expect(mocks.daily).not.toHaveBeenCalled();
  expect(mocks.pages).not.toHaveBeenCalled();
});
