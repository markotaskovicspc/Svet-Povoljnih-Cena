import { describe, expect, it } from "vitest";
import { xExpressTownSearchTerms } from "@/lib/x-express/location-search";

describe("xExpressTownSearchTerms", () => {
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
