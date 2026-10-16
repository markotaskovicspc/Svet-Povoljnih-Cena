import { describe, expect, it } from "vitest";
import { matchImportTown, searchImportTowns } from "@/lib/admin/order-import/towns";

const towns = [
  { id: 1, name: "Niš", postalCode: "18000" },
  { id: 2, name: "Beograd (Novi Beograd)", postalCode: "11070" },
  { id: 3, name: "Veternik", displayName: "Veternik (Novi Sad) - 21203", postalCode: "21203" },
  { id: 4, name: "Aranđelovac", postalCode: "34300" },
  { id: 5, name: "Novo Selo", postalCode: "18250" },
  { id: 6, name: "Novo Selo", postalCode: "36216" },
  { id: 791113, name: "Beograd (Čukarica)", postalCode: "11030" },
];
describe("whole dictionary order-import addresses", () => {
  it.each([
    ["НИШ", 1, "18000"], ["  nIS  ", 1, "18000"],
    ["Novi Beograd", 2, "11070"], ["Novi Beograd-BG", 2, "11070"],
    ["Ветерник – НС", 3, "21203"], ["Novi Sad — Veternik", 3, "21203"],
    ["Arandjelovac", 4, "34300"], ["ZARKOVO-BG", 791113, "11030"],
  ])("resolves %s with a missing or incorrect inferred postcode", (city, id, postalCode) => {
    for (const supplied of ["", "99999"]) expect(matchImportTown(towns, city, supplied))
      .toMatchObject({ xExpressTownId: id, postalCode });
  });
  it("does not guess between duplicate names, even when suggestions are truncated", () => {
    expect(matchImportTown(towns, "Novo Selo")).toBeNull();
    expect(matchImportTown(towns, "Novo Selo", "99999")).toBeNull();
    expect(matchImportTown(towns, "Novo Selo", "36216")?.xExpressTownId).toBe(6);
    expect(searchImportTowns(towns, "Novo Selo").every(t => t.autoResolved === false)).toBe(true);
    const many = Array.from({ length: 25 }, (_, id) => ({ id, name: "Novo Selo", postalCode: "18250" }));
    expect(searchImportTowns(many, "Novo Selo")).toHaveLength(20);
    expect(searchImportTowns(many, "Novo Selo").some(t => t.autoResolved)).toBe(false);
  });
  it("offers typos and partial names only as manual choices", () => {
    expect(matchImportTown(towns, "Arandelovc", "34300")).toBeNull();
    expect(searchImportTowns(towns, "Arandelovc")).toMatchObject([{ townId: 4, autoResolved: false }]);
    expect(searchImportTowns(towns, "Vetern")).toMatchObject([{ townId: 3, autoResolved: false }]);
    expect(matchImportTown(towns, "Nepoznato", "18000")).toBeNull();
  });
  it("suggests short names and transposed letters but requires an operator choice", () => {
    const dictionary = [...towns, { id: 100, name: "Beograd", postalCode: "11000" }];
    for (const [query, id] of [["Niss", 1], ["Beogard", 100]] as const) {
      expect(matchImportTown(dictionary, query)).toBeNull();
      expect(searchImportTowns(dictionary, query)).toContainEqual(expect.objectContaining({ townId: id, autoResolved: false }));
    }
  });
  it("prefers an actual locality over a routing fallback and requires an active parent", () => {
    expect(matchImportTown([], "Žarkovo")).toBeNull();
    expect(matchImportTown([{ id: 791113, name: "Drugo mesto", postalCode: "11030" }], "Žarkovo")).toBeNull();
    expect(matchImportTown([...towns, { id: 20, name: "Žarkovo", postalCode: "11030" }], "Žarkovo")?.xExpressTownId).toBe(20);
    expect(matchImportTown(towns, "Palilula")).toBeNull();
  });
});


it("shows all 17 Beograd municipalities before surrounding settlements", () => {
  const settlements = Array.from({ length: 35 }, (_, i) => ({ id: 100 + i, name: `Naselje ${i}`, displayName: `Naselje ${i} (Beograd-Grocka) - 11306`, postalCode: "11306" }));
  const central = ["Čukarica", "Novi Beograd", "Palilula", "Rakovica", "Savski Venac", "Stari Grad", "Voždovac", "Vračar", "Zemun", "Zvezdara"]
    .map((name, i) => ({ id: i + 1, name: `Beograd (${name})`, postalCode: "11000" }));
  const suburban = ["Barajevo", "Grocka", "Lazarevac", "Mladenovac", "Obrenovac", "Sopot", "Surčin"]
    .map((name, i) => ({ id: i + 20, name, postalCode: ["11460", "11306", "11550", "11400", "11500", "11450", "11271"][i] }));
  const unrelated = { id: 99, name: "Lazarevac", postalCode: "18420" };
  const dictionary = [...settlements, unrelated, ...central, ...suburban];
  for (const query of ["Beograd", "Београд", "BG"]) {
    const result = searchImportTowns(dictionary, query);
    expect(result.slice(0, 17).map(t => t.townId).sort((a,b) => a-b)).toEqual([...central, ...suburban].map(t => t.id).sort((a,b) => a-b));
    expect(result.every(t => !t.autoResolved)).toBe(true);
  }
});
