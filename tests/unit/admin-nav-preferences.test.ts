import { describe, expect, it } from "vitest";
import {
  activeAdminNavHref,
  adminNavPreferencesFromColumns,
  allowedNavFor,
  applyAdminNavPreferences,
  withArticleSavedViewLinks,
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

  it("places article saved views directly after Artikli", () => {
    const nav = withArticleSavedViewLinks(allowedNavFor("CONTENT"), [
      { id: "rabalux-view", name: "Svi artikli RAB" },
      { id: "stock-view", name: "Lageri" },
    ]);
    const erpItems = nav.find((group) => group.label === "ERP")?.items ?? [];
    const articleIndex = erpItems.findIndex(
      (item) => item.href === "/admin/erp/artikli",
    );

    expect(erpItems.slice(articleIndex, articleIndex + 3)).toMatchObject([
      { label: "Artikli" },
      {
        label: "Svi artikli RAB",
        href: "/admin/erp/artikli?view=rabalux-view",
        nested: true,
      },
      {
        label: "Lageri",
        href: "/admin/erp/artikli?view=stock-view",
        nested: true,
      },
    ]);
    expect(erpItems[articleIndex]?.nested).toBeUndefined();
  });

  it("marks the selected saved view active from its query parameter", () => {
    const nav = withArticleSavedViewLinks(allowedNavFor("CONTENT"), [
      { id: "stock-view", name: "Lageri" },
    ]);

    expect(
      activeAdminNavHref(nav, "/admin/erp/artikli", "view=stock-view"),
    ).toBe("/admin/erp/artikli?view=stock-view");
  });
});
