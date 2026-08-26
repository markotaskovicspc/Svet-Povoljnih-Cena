import { describe, expect, it } from "vitest";
import {
  resolveExactRemoteCity,
  type CityAutocompletePlace,
} from "@/components/forms/city-autocomplete";

const places: CityAutocompletePlace[] = [
  { name: "Stara Pazova", postalCode: "22300", townId: 804428 },
  { name: "Nova Pazova", postalCode: "22330", townId: 803855 },
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

  it("does not resolve a partial city name", () => {
    expect(resolveExactRemoteCity(places, "Pazova")).toBeNull();
  });
});
