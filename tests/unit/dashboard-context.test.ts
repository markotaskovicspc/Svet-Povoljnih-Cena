import { describe, expect, it } from "vitest";
import {
  cleanDashboardContext,
  dashboardContextFromSavedColumns,
  hasDashboardContext,
  resolveDashboardFilters,
} from "@/lib/admin/dashboard-context";

describe("dashboard filter context", () => {
  const julyNow = new Date("2026-07-27T10:00:00.000Z");

  it("uses rolling 30-day defaults when there is no saved context", () => {
    const resolved = resolveDashboardFilters({}, julyNow);

    expect(resolved.context.ordersRange).toBe("30d");
    expect(resolved.context.ordersFrom).toBe("2026-06-28");
    expect(resolved.context.fiscalRange).toBe("30d");
    expect(resolved.context.warehouseId).toBe("");
  });

  it("keeps relative presets relative when the dashboard is reopened later", () => {
    const saved = { ordersRange: "7d" as const };

    expect(resolveDashboardFilters(saved, julyNow).context.ordersFrom).toBe(
      "2026-07-21",
    );
    expect(
      resolveDashboardFilters(
        saved,
        new Date("2026-08-03T10:00:00.000Z"),
      ).context.ordersFrom,
    ).toBe("2026-07-28");
  });

  it("treats legacy from/to saved views as fixed custom periods", () => {
    const resolved = resolveDashboardFilters(
      { ordersFrom: "2026-07-05", ordersTo: "2026-07-20" },
      julyNow,
    );

    expect(resolved.context.ordersRange).toBe("custom");
    expect(resolved.context.ordersFrom).toBe("2026-07-05");
    expect(resolved.context.ordersTo).toBe("2026-07-20");
  });

  it("reads context from saved columns and rejects unknown or invalid values", () => {
    const context = dashboardContextFromSavedColumns({
      context: {
        warehouseId: "warehouse-1",
        fiscalRange: "mtd",
        fiscalFrom: "2026-07-01",
        fiscalTo: "2026-07-27",
        ordersRange: "invalid",
        unknown: "value",
      },
    });

    expect(context).toEqual({
      warehouseId: "warehouse-1",
      fiscalRange: "mtd",
      fiscalFrom: "2026-07-01",
      fiscalTo: "2026-07-27",
    });
    expect(cleanDashboardContext({ ordersFrom: "not-a-date" })).toEqual({});
    expect(hasDashboardContext(context)).toBe(true);
    expect(hasDashboardContext({ forbidden: "1" })).toBe(false);
  });
});
