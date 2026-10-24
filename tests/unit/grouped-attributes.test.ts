import { describe, expect, it } from "vitest";
import { groupedAttributeFacets, matchesGroupedAttributes, projectGroupedAttributes } from "@/lib/grouped-attributes";
import { appendFilterQueryParams, emptyFilterState } from "@/lib/listing/filters";
import { parseListProductsInput } from "@/lib/api/product-query";

const left = { sectionId: "angle", sectionName: "Ugao", sectionOrder: 1,
  optionId: "left", value: "Levi", order: 0 };
const right = { ...left, optionId: "right", value: "Desni", order: 1 };
const yes = { sectionId: "storage", sectionName: "Kutija", sectionOrder: 2,
  optionId: "yes", value: "Da", order: 0 };

describe("grouped article attributes", () => {
  it("counts each article once and orders sections and values by configured order", () => {
    const facets = groupedAttributeFacets([
      { groupedAttributes: [yes, right, left, left] }, { groupedAttributes: [left] },
    ]);
    expect(facets.map((section) => section.id)).toEqual(["angle", "storage"]);
    expect(facets[0].values.map((value) => [value.id, value.count])).toEqual([["left", 2], ["right", 1]]);
  });

  it("uses OR within a section and AND between sections, including missing values", () => {
    expect(matchesGroupedAttributes([left, yes], { angle: ["left", "right"], storage: ["yes"] })).toBe(true);
    expect(matchesGroupedAttributes([right], { angle: ["left", "right"], storage: ["yes"] })).toBe(false);
    expect(matchesGroupedAttributes([], { angle: ["left"] })).toBe(false);
  });

  it("keeps identically named values separate by stable identity", () => {
    const otherYes = { ...yes, sectionId: "sleep", sectionName: "Razvlačenje", optionId: "sleep-yes" };
    expect(matchesGroupedAttributes([yes], { sleep: ["sleep-yes"] })).toBe(false);
    expect(groupedAttributeFacets([{ groupedAttributes: [yes, otherYes] }])).toHaveLength(2);
  });

  it("round-trips ID selections through the public product API query", () => {
    const state = { ...emptyFilterState(), groupedAttributes: { angle: ["left", "right"], storage: ["yes"] } };
    const query = appendFilterQueryParams(new URLSearchParams(), state, "default");
    expect(parseListProductsInput(query).groupedAttributes).toEqual(state.groupedAttributes);
  });

  it("omits deactivated sections and options from public projections", () => {
    const option = { id: "a", value: "Da", order: 0, active: true,
      section: { id: "s", name: "Celina", order: 0, active: false } };
    expect(projectGroupedAttributes([{ option }])).toEqual([]);
    expect(projectGroupedAttributes([{ option: { ...option, active: false, section: { ...option.section, active: true } } }])).toEqual([]);
  });
});
