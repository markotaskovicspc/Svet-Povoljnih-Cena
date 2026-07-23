import { describe, expect, it } from "vitest";
import {
  articleSlug,
  composeArticleName,
  splitArticleValues,
} from "@/lib/article-master";

describe("article master helpers", () => {
  it("composes the shared article name in the required order", () => {
    expect(
      composeArticleName({
        collection: "Björn",
        shortDescription: "Otvorena polica",
        shortName: "N2212",
      }),
    ).toBe("Björn Otvorena polica N2212");
  });

  it("normalizes blank pieces, duplicate lookup values and Serbian slugs", () => {
    expect(
      composeArticleName({
        collection: "  Björn ",
        shortDescription: "",
        shortName: " N2212 ",
      }),
    ).toBe("Björn N2212");
    expect(splitArticleValues("Hrast, hrast; Metal\nGrafit")).toEqual([
      "hrast",
      "Metal",
      "Grafit",
    ]);
    expect(articleSlug("Čelična polica")).toBe("celicna-polica");
  });
});
