import { describe, expect, it } from "vitest";
import {
  activeAdminNavHref,
  adminNavPreferencesFromColumns,
  allowedNavFor,
  applyAdminNavPreferences,
  withArticleSavedViewLinks,
  withSavedViewLinks,
} from "@/lib/admin/nav";

describe("personal admin navigation", () => {
  const purchaseView = {
    id: "purchase-view",
    name: "Nabavne porudžbenice",
    module: "nabavne-porudzbenice",
    title: "Nabavne porudžbenice",
    columns: { showInSidebar: true },
    allowed: ["OPS"] as const,
  };
  const purchaseHref =
    "/admin/erp/nabavne-porudzbenice?savedView=purchase-view";

  it("moves a bottom shortcut between standard pages and keeps its saved position", () => {
    const available = withSavedViewLinks(allowedNavFor("OPS"), [purchaseView]);
    expect(available.at(-1)?.label).toBe("Moji pogledi");
    const preferences = adminNavPreferencesFromColumns({
      visibleColumns: ["/admin", purchaseHref, "/admin/checkouti"],
      columnOrder: ["/admin", purchaseHref, "/admin/checkouti"],
    });
    const customized = applyAdminNavPreferences(available, preferences);
    expect(
      customized.flatMap((group) => group.items.map((item) => item.href)),
    ).toEqual(["/admin", purchaseHref, "/admin/checkouti"]);
    expect(
      activeAdminNavHref(
        customized,
        "/admin/erp/nabavne-porudzbenice",
        "savedView=purchase-view",
      ),
    ).toBe(purchaseHref);
  });

  it("preserves newly pinned views and old menus, even when the parent page is hidden", () => {
    const available = withSavedViewLinks(allowedNavFor("OPS"), [
      purchaseView,
      {
        ...purchaseView,
        id: "sales",
        module: "prodajni-nalozi",
        name: "Nalozi",
      },
    ]);
    const preferences = {
      visibleHrefs: ["/admin/checkouti"],
      order: ["/admin/checkouti"],
    };
    const items = applyAdminNavPreferences(available, preferences)[0]!.items;
    expect(items.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/checkouti",
      "/admin/erp/prodajni-nalozi?savedView=sales",
      purchaseHref,
    ]);
    expect(
      items
        .filter((item) => item.savedViewId)
        .every((item) => !item.parentHref),
    ).toBe(true);
    const withParent = applyAdminNavPreferences(available, {
      visibleHrefs: ["/admin/erp/prodajni-nalozi", "/admin/checkouti"],
      order: ["/admin/erp/prodajni-nalozi", "/admin/checkouti"],
    });
    expect(withParent[0]!.items.slice(1, 4).map((item) => item.href)).toEqual([
      "/admin/erp/prodajni-nalozi",
      "/admin/erp/prodajni-nalozi?savedView=sales",
      "/admin/checkouti",
    ]);
  });

  it("honors a hidden saved shortcut and ignores deleted or foreign shortcuts", () => {
    const available = withSavedViewLinks(allowedNavFor("OPS"), [purchaseView]);
    const customized = applyAdminNavPreferences(available, {
      visibleHrefs: ["/admin", "/admin/erp/artikli?savedView=foreign"],
      order: [purchaseHref, "/admin/erp/artikli?savedView=foreign"],
    });
    expect(customized[0]!.items.map((item) => item.href)).toEqual(["/admin"]);
  });

  it("detaches a manually moved view from its collapsible parent", () => {
    const href = "/admin/erp/prodajni-nalozi?savedView=sales";
    const available = withSavedViewLinks(allowedNavFor("OPS"), [
      { ...purchaseView, id: "sales", module: "prodajni-nalozi" },
    ]);
    const customized = applyAdminNavPreferences(available, {
      visibleHrefs: [href, "/admin/checkouti", "/admin/erp/prodajni-nalozi"],
      order: [href, "/admin/checkouti", "/admin/erp/prodajni-nalozi"],
    });
    expect(customized[0]!.items[1]).toMatchObject({
      href,
      nested: false,
      parentHref: undefined,
    });
  });

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
