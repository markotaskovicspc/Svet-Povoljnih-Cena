import { describe, expect, it } from "vitest";
import {
  preferExactCityMatches,
  resolveExactRemoteCity,
  type CityAutocompletePlace,
} from "@/components/forms/city-autocomplete";
import { visibleCityError } from "@/components/checkout/shipping-form";

const places: CityAutocompletePlace[] = [
  { name: "Stara Pazova", postalCode: "22300", townId: 804428 },
  { name: "Nova Pazova", postalCode: "22330", townId: 803855 },
  { name: "Niš", postalCode: "18000", townId: 792047 },
];

describe("resolveExactRemoteCity", () => {
  it("resolves a unique exact provider city", () => {
    expect(resolveExactRemoteCity(places, " stara pazova ")?.townId).toBe(
      804428,
    );
  });

  it("uses the postal code to disambiguate same-name provider cities", () => {
    const duplicates: CityAutocompletePlace[] = [
      { name: "Primer", postalCode: "11000", townId: 1 },
      { name: "Primer", postalCode: "21000", townId: 2 },
    ];

    expect(resolveExactRemoteCity(duplicates, "Primer", "21000")?.townId).toBe(
      2,
    );
    expect(resolveExactRemoteCity(duplicates, "Primer")).toBeNull();
  });

  it("repairs a stale GLS postal mapping when the X Express city is unique", () => {
    expect(
      resolveExactRemoteCity(places, "Stara Pazova", "99999")?.townId,
    ).toBe(804428);
  });

  it("resolves Niš with or without the diacritic", () => {
    expect(resolveExactRemoteCity(places, "Niš")?.townId).toBe(792047);
    expect(resolveExactRemoteCity(places, "nis")?.townId).toBe(792047);
  });

  it("resolves a verified locality alias without treating a partial name as exact", () => {
    const locality = [{ name: "Žarkovo", postalCode: "11030", townId: 791113, aliases: ["Zarkovo BG", "Žarkovo BG"] }];
    expect(resolveExactRemoteCity(locality, "Zarkovo BG", "11000")?.postalCode).toBe("11030");
    expect(resolveExactRemoteCity(locality, "ZARKOVO-BG")?.townId).toBe(791113);
    expect(resolveExactRemoteCity(locality, "Zark")).toBeNull();
  });

  it("does not resolve a partial city name", () => {
    expect(resolveExactRemoteCity(places, "Pazova")).toBeNull();
  });
});

describe("visibleCityError", () => {
  it("shows the hidden X Express town validation error on the visible city field", () => {
    expect(
      visibleCityError(
        undefined,
        "Izaberite grad / mesto iz ponuđene liste",
      ),
    ).toBe("Izaberite grad / mesto iz ponuđene liste");
  });

  it("keeps the direct city validation error when both errors exist", () => {
    expect(
      visibleCityError(
        "Unesite grad",
        "Izaberite grad / mesto iz ponuđene liste",
      ),
    ).toBe("Unesite grad");
  });
});

it("does not auto-select an explicitly ambiguous or fuzzy server suggestion", () => {
  expect(resolveExactRemoteCity([{ name: "Novo Selo", postalCode: "18250", townId: 1, autoResolved: false }], "Novo Selo", "18250")).toBeNull();
  expect(resolveExactRemoteCity([{ name: "Novi Sad (Veternik)", postalCode: "21203", townId: 3, autoResolved: true }], "Veternik-NS")).toMatchObject({ townId: 3 });
});


describe("Beograd municipality suggestions", () => {
  it("keeps all municipality choices alongside the exact city", () => {
    const items = [
      { name: "Beograd", postalCode: "11000" },
      { name: "Beograd — Palilula", postalCode: "11060" },
      { name: "Barajevo", postalCode: "11460" },
    ];
    expect(preferExactCityMatches(items, "Београд")).toEqual(items);
    expect(preferExactCityMatches(items, "Barajevo")).toEqual([items[2]]);
  });
});
