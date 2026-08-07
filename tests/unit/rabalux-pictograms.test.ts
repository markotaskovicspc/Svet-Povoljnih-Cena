import { describe, expect, it } from "vitest";
import {
  deriveRabaluxPictogramCodes,
  rabaluxPictogramPriority,
} from "@/lib/rabalux/pictograms";

describe("Rabalux pictogram rules", () => {
  it("shows explicit three-year warranty but not a derived warranty", () => {
    expect(
      deriveRabaluxPictogramCodes({
        warrantyYears: 3,
        warrantyExplicit: true,
        technicalSpecs: [],
      }),
    ).toEqual(["rabalux-warranty-3"]);
    expect(
      deriveRabaluxPictogramCodes({
        warrantyYears: 5,
        warrantyExplicit: false,
        technicalSpecs: [],
      }),
    ).toEqual([]);
  });

  it("requires a numeric IP rating of at least 44", () => {
    const codes = (value: string) =>
      deriveRabaluxPictogramCodes({
        warrantyYears: 2,
        warrantyExplicit: false,
        technicalSpecs: [{ key: "IP_protection", label: "IP", value }],
      });
    expect(codes("IP43")).not.toContain("rabalux-ip44-plus");
    expect(codes("IP44")).toContain("rabalux-ip44-plus");
    expect(codes("Zaštita IP65")).toContain("rabalux-ip44-plus");
  });

  it("keeps warranty ahead of feature badges", () => {
    expect(rabaluxPictogramPriority("rabalux-warranty-5")).toBeLessThan(
      rabaluxPictogramPriority("rabalux-led"),
    );
    expect(rabaluxPictogramPriority("rabalux-led")).toBeLessThan(
      rabaluxPictogramPriority("rabalux-ip44-plus"),
    );
  });
});
