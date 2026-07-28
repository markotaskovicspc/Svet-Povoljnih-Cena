import { describe, expect, it } from "vitest";
import {
  getPromoTabPresentation,
  pictogramMediaAsset,
} from "@/data/campaign-icons";
import type { Tab } from "@/types";

const customTab: Tab = {
  id: "tab-1",
  label: "Evonek",
  href: "/brend/evonek",
  order: 1,
  pictogram: {
    id: "pictogram-1",
    code: "evonek",
    label: "Evonek",
    iconUrl: "https://cdn.example.test/pictograms/evonek.png",
  },
};

describe("pictogram reuse", () => {
  it("converts a library pictogram into a stable image asset", () => {
    expect(pictogramMediaAsset(customTab.pictogram)).toEqual({
      url: "https://cdn.example.test/pictograms/evonek.png",
      alt: "Evonek",
      width: 96,
      height: 96,
    });
  });

  it("prefers the assigned pictogram and preserves the configured tab destination", () => {
    const presentation = getPromoTabPresentation(customTab);

    expect(presentation.label).toBe("Evonek");
    expect(presentation.href).toBe("/brend/evonek");
    expect(presentation.iconAsset?.url).toBe(customTab.pictogram?.iconUrl);
    expect(presentation.iconKey).toBeUndefined();
  });

  it("keeps the legacy campaign fallback when no pictogram is assigned", () => {
    const presentation = getPromoTabPresentation({
      id: "tab-2",
      label: "Mesečna akcija",
      href: "/akcija",
      order: 2,
      icon: "Tag",
    });

    expect(presentation.iconAsset?.url).toBe("/brand/promo-stickers/akcija.svg");
    expect(presentation.iconKey).toBe("mesecna-akcija");
  });
});
