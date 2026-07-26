import { describe, expect, it } from "vitest";
import { erpDashboardModules } from "@/lib/admin/erp";

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
  it("shows the 18 primary modules in the requested order", () => {
    expect(erpDashboardModules.slice(0, 18).map((item) => item.number)).toEqual(
      Array.from({ length: 18 }, (_, index) => String(index + 1)),
    );
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

  it("numbers every remaining ERP module sequentially from 19", () => {
    const secondaryModules = erpDashboardModules.slice(18);

    expect(secondaryModules.map((item) => item.number)).toEqual(
      secondaryModules.map((_, index) => String(19 + index)),
    );
  });
});
