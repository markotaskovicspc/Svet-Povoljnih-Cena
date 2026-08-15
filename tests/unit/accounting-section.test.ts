import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_SECTION_VIEWS,
  getAccountingSectionView,
} from "@/lib/admin/accounting-section";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { activeAdminNavHref, adminNav } from "@/lib/admin/nav";

describe("ERP tačka 15", () => {
  it("contains the five client-requested bookkeeping views in order", () => {
    expect(ACCOUNTING_SECTION_VIEWS.map((view) => view.label)).toEqual([
      "Evidencija prometa",
      "Evidencija storniranja i refundacija",
      "Kalkulacije",
      "Nivelacije",
      "KEP knjiga",
    ]);
    expect(ACCOUNTING_SECTION_VIEWS.map((view) => view.number)).toEqual([
      "15.1",
      "15.2",
      "15.3",
      "15.4",
      "15.5",
    ]);
  });

  it("falls back to turnover for an unknown or missing view", () => {
    expect(getAccountingSectionView(undefined).key).toBe("promet");
    expect(getAccountingSectionView("nepoznato").key).toBe("promet");
  });

  it("links the bookkeeping section from the ERP sidebar for operations admins", () => {
    const erp = adminNav.find((group) => group.label === "ERP");
    expect(erp?.items).toContainEqual({
      href: "/admin/erp/racunovodstveni-registri",
      label: "Knjigovodstveni izveštaji",
      allowed: ["OPS"],
    });
  });

  it("links purchasing documents from the ERP sidebar with the client-facing names", () => {
    const erp = adminNav.find((group) => group.label === "ERP");
    expect(
      erp?.items
        .filter((item) =>
          ["/admin/erp/porudzbenice", "/admin/erp/ulazne-fakture"].includes(
            item.href,
          ),
        )
        .map((item) => item.label),
    ).toEqual(["Nabavne porudžbenice", "Prijemnice"]);
  });

  it("highlights the precise bookkeeping route instead of the generic ERP workspace", () => {
    expect(
      activeAdminNavHref(
        adminNav,
        "/admin/erp/racunovodstveni-registri",
      ),
    ).toBe("/admin/erp/racunovodstveni-registri");
  });

  it("allows operations and content admins to use the shared nivelation module", () => {
    expect(allowedRolesForErpModule("mp-cene")).toEqual(["CONTENT", "OPS"]);
  });
});
