import { describe, expect, it } from "vitest";
import {
  adminNavPreferencesFromColumns,
  allowedNavFor,
  applyAdminNavPreferences,
} from "@/lib/admin/nav";

describe("personal admin navigation", () => {
  it("keeps the dashboard and only applies allowed saved links", () => {
    const contentNav = allowedNavFor("CONTENT");
    const customized = applyAdminNavPreferences(contentNav, {
      visibleHrefs: [
        "/admin/pocetna",
        "/admin/erp/akcije",
        "/admin/erp/magacini",
      ],
      order: [
        "/admin/erp/magacini",
        "/admin/erp/akcije",
        "/admin/pocetna",
      ],
    });

    expect(customized).toHaveLength(1);
    expect(customized[0]?.label).toBe("Moj meni");
    expect(customized[0]?.items.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/erp/akcije",
      "/admin/pocetna",
    ]);
  });

  it("parses unique href arrays and rejects unrelated JSON", () => {
    expect(
      adminNavPreferencesFromColumns({
        visibleColumns: ["/admin", "/admin", 42],
        columnOrder: ["/admin/pocetna", "/admin/pocetna"],
      }),
    ).toEqual({
      visibleHrefs: ["/admin"],
      order: ["/admin/pocetna"],
    });
    expect(adminNavPreferencesFromColumns({ visibleColumns: [] })).toBeNull();
  });
});
