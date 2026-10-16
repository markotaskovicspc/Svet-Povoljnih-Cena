import { describe, expect, it } from "vitest";
import { beogradMunicipalitySeats, xExpressTownSearchTerms } from "@/lib/x-express/location-search";

describe("xExpressTownSearchTerms", () => {
  it("includes all 17 Beograd municipalities using provider town spellings", () => {
    expect(xExpressTownSearchTerms("Beograd")).toEqual(expect.arrayContaining([
      "Barajevo", "Voždovac", "Vračar", "Grocka", "Zvezdara", "Zemun",
      "Lazarevac", "Mladenovac", "Novi Beograd", "Obrenovac", "Palilula",
      "Rakovica", "Savski venac", "Sopot", "Stari grad", "Surčin", "Čukarica",
    ]));
  });

  it.each(["Barajevo", "Grocka", "Lazarevac", "Mladenovac", "Obrenovac", "Sopot", "Surčin"])(
    "finds %s when prefixed with Beograd", (name) => {
      expect(xExpressTownSearchTerms(`Beograd ${name}`)).toContain(name);
    },
  );

  it("expands a city typed without Serbian diacritics", () => {
    expect(xExpressTownSearchTerms("Nis")).toContain("Niš");
    expect(xExpressTownSearchTerms("Cacak")).toContain("Čačak");
  });

  it("keeps the original provider query first", () => {
    expect(xExpressTownSearchTerms("Novi Sad")[0]).toBe("Novi Sad");
  });

  it("does not search before the autocomplete minimum", () => {
    expect(xExpressTownSearchTerms("N")).toEqual([]);
  });
});

describe("Beograd municipality seats", () => {
  it("disambiguates suburban municipalities by their real postcodes", () => {
    const seats = beogradMunicipalitySeats("Београд");
    expect(seats).toHaveLength(7);
    expect(seats).toContainEqual(expect.objectContaining({ name: "Lazarevac", postalCode: "11550" }));
    expect(seats).toContainEqual(expect.objectContaining({ name: "Sopot", postalCode: "11450" }));
    expect(seats).toContainEqual(expect.objectContaining({ name: "Obrenovac", postalCode: "11500" }));
    expect(beogradMunicipalitySeats("Lazarevac")).toEqual([]);
  });
});
