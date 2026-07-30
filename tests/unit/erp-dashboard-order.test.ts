import { describe, expect, it } from "vitest";
import { erpDashboardModules, getErpModuleDefinition } from "@/lib/admin/erp";

const primaryModuleTitles = [
  "Matični podaci o artiklima",
  "Matični podaci o dobavljačima",
  "Cenovnik nabavnih cena",
  "Nabavne porudžbenice",
  "Ulazne fakture",
  "Cenovnici",
  "Upravljanje akcijskim cenama i prioritetima",
  "Magacini",
  "Lageri",
  "Pregled porudžbina",
  "Fiskalizacija i refundacija",
  "Otpremnice",
  "Nalozi za preuzimanje (Kurirske službe)",
  "Povezivanje sa Ananasom",
  "Knjigovodstveni izveštaji",
  "API za razmenu lagera i rezervacije",
  "Popisi",
  "Baza kupaca",
];

describe("ERP dashboard module order", () => {
  it("shows the primary modules in the requested order and makes the customer base module 19", () => {
    expect(erpDashboardModules.slice(0, 18).map((item) => item.number)).toEqual([
      ...Array.from({ length: 17 }, (_, index) => String(index + 1)),
      "19",
    ]);
    expect(erpDashboardModules.slice(0, 18).map((item) => item.title)).toEqual(
      primaryModuleTitles,
    );
  });

  it("links fiscalization to its dedicated admin screen", () => {
    expect(erpDashboardModules[10]).toMatchObject({
      slug: "fiskalizacija",
      href: "/admin/fiskalizacija",
    });
  });

  it("shows the complete person and company customer-master columns", () => {
    const customerModule = getErpModuleDefinition("kupci");

    expect(customerModule?.number).toBe("19");
    expect(customerModule?.columns.map((column) => column.label)).toEqual([
      "Vrsta",
      "Ime i prezime / firma",
      "PIB",
      "Matični broj",
      "Adresa",
      "Mesto",
      "Poštanski broj",
      "Država",
      "Telefon",
      "E-mail",
      "Pol",
    ]);
    expect(customerModule?.editableColumns).not.toContain("gender");
  });

  it("numbers every remaining ERP module sequentially from 20", () => {
    const secondaryModules = erpDashboardModules.slice(18);

    expect(secondaryModules.map((item) => item.number)).toEqual(
      secondaryModules.map((_, index) => String(20 + index)),
    );
  });
});
