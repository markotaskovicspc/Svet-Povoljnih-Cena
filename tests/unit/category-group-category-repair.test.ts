import { describe, expect, it } from "vitest";

// The repair script exports its pure classifier and only opens a database when
// invoked as the main process.
import { classifyCategoryGroupMismatches } from "../../scripts/category-group-category-repair.mjs";

const categories = [
  {
    id: "root",
    name: "Nameštaj",
    slug: "namestaj",
    path: "/namestaj",
    parentId: null,
  },
  {
    id: "chairs",
    name: "Trpezarijske stolice i stolovi",
    slug: "trpezarijske-stolice-i-stolovi",
    path: "/namestaj/trpezarijske-stolice-i-stolovi",
    parentId: "root",
  },
  {
    id: "other",
    name: "Kancelarijske stolice",
    slug: "kancelarijske-stolice",
    path: "/namestaj/kancelarijske-stolice",
    parentId: "root",
  },
];

function product(categoryIds: string[]) {
  return {
    id: "product-1",
    sku: "110088",
    name: "DIAMOND SEAT",
    group: {
      name: "Trpezarijske stolice i stolovi",
      slug: "trpezarijske-stolice-i-stolovi",
    },
    categories: categoryIds.map((id) => ({
      category: categories.find((category) => category.id === id)!,
    })),
  };
}

describe("category/group repair classification", () => {
  it("treats a missing category and an ancestor assignment as safe", () => {
    expect(
      classifyCategoryGroupMismatches(categories, [product([])])[0],
    ).toMatchObject({ classification: "SAFE", reason: "NO_PUBLIC_CATEGORY" });
    expect(
      classifyCategoryGroupMismatches(categories, [product(["root"])])[0],
    ).toMatchObject({ classification: "SAFE", reason: "CURRENT_IS_ANCESTOR" });
  });

  it("leaves a different public branch for manual review", () => {
    expect(
      classifyCategoryGroupMismatches(categories, [product(["other"])])[0],
    ).toMatchObject({
      classification: "ASK_MARKO",
      reason: "DIFFERENT_BRANCH_OR_LEAF",
    });
  });

  it("does not report an already aligned product", () => {
    expect(
      classifyCategoryGroupMismatches(categories, [product(["chairs"])]),
    ).toEqual([]);
  });
});
