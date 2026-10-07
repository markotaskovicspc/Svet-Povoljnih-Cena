import { describe, expect, it } from "vitest";
import {
  savedGridViewHref,
  savedViewLocation,
  savedViewMetadata,
} from "@/lib/admin/saved-views";
import {
  allowedNavFor,
  withSavedViewLinks,
  activeAdminNavHref,
} from "@/lib/admin/nav";

describe("saved grid shortcuts", () => {
  it("retains old article shortcuts without publishing other old views", () => {
    expect(savedViewMetadata("artikli", {}).showInSidebar).toBe(true);
    expect(savedViewMetadata("prodajni-nalozi", {}).showInSidebar).toBe(false);
    expect(
      savedViewMetadata("artikli", { showInSidebar: false }).showInSidebar,
    ).toBe(false);
  });
  it("keeps page filters and discards arbitrary paths and edit state", () => {
    expect(
      savedViewLocation("prodajni-nalozi", "https://evil.test", {
        channel: "WEB",
        loyalty: "guest",
        edit: "123",
        savedView: "old",
      }),
    ).toEqual({
      pagePath: "/admin/erp/prodajni-nalozi",
      routeContext: { channel: "WEB", loyalty: "guest" },
    });
    expect(
      savedGridViewHref("artikli", {
        id: "a&b",
        routeContext: { view: "archived-articles" },
      }),
    ).toBe("/admin/erp/artikli?view=archived-articles&savedView=a%26b");
    expect(
      savedViewLocation("artikli", undefined, { view: "old-personal-view" })
        .routeContext,
    ).toEqual({});
  });
  it("preserves accounting section and prevents a module/section mismatch", () => {
    expect(
      savedViewLocation(
        "ulazne-fakture",
        "/admin/erp/racunovodstveni-registri",
        { prikaz: "kalkulacije" },
      ),
    ).toEqual({
      pagePath: "/admin/erp/racunovodstveni-registri",
      routeContext: { prikaz: "kalkulacije" },
    });
    expect(
      savedViewLocation("artikli", "/admin/erp/racunovodstveni-registri", {
        prikaz: "kalkulacije",
      }).pagePath,
    ).toBe("/admin/erp/artikli");
  });
  it("nests pinned shortcuts in saved order and supports pages hidden from the menu", () => {
    const views = [
      {
        id: "b",
        name: "B",
        module: "prodajni-nalozi",
        title: "Nalozi",
        allowed: ["OPS"] as const,
        columns: { showInSidebar: true, sidebarOrder: 1 },
      },
      {
        id: "a",
        name: "A",
        module: "prodajni-nalozi",
        title: "Nalozi",
        allowed: ["OPS"] as const,
        columns: { showInSidebar: true, sidebarOrder: 0 },
      },
      {
        id: "hidden",
        name: "Hidden",
        module: "prodajni-nalozi",
        title: "Nalozi",
        allowed: ["OPS"] as const,
        columns: { showInSidebar: false },
      },
    ];
    const nav = withSavedViewLinks(allowedNavFor("OPS"), views);
    const nested = nav
      .flatMap((group) => group.items)
      .filter((item) => item.parentHref === "/admin/erp/prodajni-nalozi");
    expect(nested.map((item) => item.label)).toEqual(["A", "B"]);
    expect(
      activeAdminNavHref(nav, "/admin/erp/prodajni-nalozi", "savedView=b"),
    ).toBe("/admin/erp/prodajni-nalozi?savedView=b");
    expect(
      withSavedViewLinks([], views)[0]?.items.map((item) => item.label),
    ).toEqual(["A · Nalozi", "B · Nalozi"]);
  });
});
