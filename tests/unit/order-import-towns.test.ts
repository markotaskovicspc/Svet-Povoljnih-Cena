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
  it("prefers an actual locality over a routing fallback and requires an active parent", () => {
    expect(matchImportTown([], "Žarkovo")).toBeNull();
    expect(matchImportTown([{ id: 791113, name: "Drugo mesto", postalCode: "11030" }], "Žarkovo")).toBeNull();
    expect(matchImportTown([...towns, { id: 20, name: "Žarkovo", postalCode: "11030" }], "Žarkovo")?.xExpressTownId).toBe(20);
    expect(matchImportTown(towns, "Palilula")).toBeNull();
  });
});
