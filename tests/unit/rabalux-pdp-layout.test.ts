import { describe, expect, it } from "vitest";
import { resolveProductPdpLayout } from "@/lib/product-pdp-layout";

describe("Rabalux PDP layout", () => {
  it("moves structured specifications into description and hides duplicate blocks", () => {
    const technicalSpecs = [{ key: "IP_protection", label: "IP zaštita", value: "IP44" }];
    expect(
      resolveProductPdpLayout({
        supplierIntegrationKey: "RABALUX",
        technicalSpecs,
      }),
    ).toEqual({
      isRabalux: true,
      showStandaloneMaterials: false,
      showStandaloneTechnicalAndDocuments: false,
      descriptionTechnicalSpecs: technicalSpecs,
    });
  });

  it("keeps the existing layout for all other suppliers", () => {
    expect(
      resolveProductPdpLayout({
        supplierIntegrationKey: "OTHER",
        technicalSpecs: [],
      }),
    ).toMatchObject({
      isRabalux: false,
      showStandaloneMaterials: true,
      showStandaloneTechnicalAndDocuments: true,
      descriptionTechnicalSpecs: undefined,
    });
  });
});
