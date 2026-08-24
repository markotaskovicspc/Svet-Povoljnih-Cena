import { describe, expect, it } from "vitest";
import {
  normalizeSearchTerm,
  searchTextMatchesTokens,
  tokenizeSearchQuery,
} from "@/lib/api/search";

describe("tokenizovana delimična pretraga proizvoda", () => {
  it("normalizuje velika slova, dijakritike i interpunkciju", () => {
    expect(tokenizeSearchQuery("  TRP, sto  ")).toEqual(["trp", "sto"]);
    expect(tokenizeSearchQuery("Čelični-STO")).toEqual(["celicni", "sto"]);
    expect(normalizeSearchTerm("Đački sto")).toBe("dackisto");
  });

  it("zahteva da se svaki deo upita poklopi nezavisno od redosleda", () => {
    const searchable = ["Trpezarijski sto Verona", "Trpezarijski stolovi"];

    expect(searchTextMatchesTokens("TRP sto", searchable)).toBe(true);
    expect(searchTextMatchesTokens("sto TRP", searchable)).toBe(true);
    expect(searchTextMatchesTokens("trpez stol", searchable)).toBe(true);
  });

  it("ne prihvata rezultat kada nedostaje makar jedan deo upita", () => {
    expect(
      searchTextMatchesTokens("TRP lampa", [
        "Trpezarijski sto Verona",
        "Trpezarijski stolovi",
      ]),
    ).toBe(false);
  });

  it("dvoslovna reč mora biti cela, dok tri znaka mogu biti prefiks", () => {
    expect(searchTextMatchesTokens("TV sto", ["TV komoda", "Stolovi"])).toBe(true);
    expect(searchTextMatchesTokens("TV sto", ["Tvoj sto"])).toBe(false);
  });

  it("ignoriše jednoslovne delove umesto da proširi rezultate", () => {
    expect(tokenizeSearchQuery("x TRP sto")).toEqual(["trp", "sto"]);
    expect(tokenizeSearchQuery("sto 3 x 5")).toEqual(["sto", "3", "5"]);
  });
});
