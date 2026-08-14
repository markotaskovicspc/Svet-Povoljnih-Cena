import { describe, expect, it } from "vitest";
import {
  articleCategoryChildren,
  articleCategorySelectionAfterChange,
  articleCategorySelectionFromLeaf,
  requiredArticleCategorySelectionError,
  resolveArticleCategorySelection,
  type ArticleCategoryNode,
} from "@/lib/admin/article-category-hierarchy";

const categories: ArticleCategoryNode[] = [
  { id: "root", name: "Nameštaj", parentId: null, order: 1 },
  { id: "other-root", name: "Rasveta", parentId: null, order: 2 },
  {
    id: "dining",
    name: "Trpezarijske stolice i stolovi",
    parentId: "root",
    order: 2,
  },
  { id: "chairs", name: "Stolice", parentId: "dining", order: 1 },
  { id: "lamps", name: "Lampe", parentId: "other-root", order: 1 },
];

describe("article category hierarchy", () => {
  it("returns only direct children in navigation order", () => {
    expect(articleCategoryChildren(categories, "root").map(({ id }) => id)).toEqual([
      "dining",
    ]);
  });

  it("reconstructs all three selectors from the saved leaf", () => {
    expect(articleCategorySelectionFromLeaf(categories, "chairs")).toEqual({
      siteCategoryId: "root",
      siteGroupId: "dining",
      siteSubgroupId: "chairs",
    });
  });

  it("clears invalid lower selections when a parent changes", () => {
    const selection = {
      siteCategoryId: "root",
      siteGroupId: "dining",
      siteSubgroupId: "chairs",
    };

    expect(
      articleCategorySelectionAfterChange(selection, "category", "other-root"),
    ).toEqual({
      siteCategoryId: "other-root",
      siteGroupId: "",
      siteSubgroupId: "",
    });
    expect(
      articleCategorySelectionAfterChange(selection, "group", "lamps"),
    ).toEqual({
      siteCategoryId: "root",
      siteGroupId: "lamps",
      siteSubgroupId: "",
    });
  });

  it("uses the deepest valid selection as the storefront category", () => {
    expect(
      resolveArticleCategorySelection(categories, {
        siteCategoryId: "root",
        siteGroupId: "dining",
        siteSubgroupId: "chairs",
      }).leafCategoryId,
    ).toBe("chairs");
    expect(
      resolveArticleCategorySelection(categories, {
        siteCategoryId: "root",
        siteGroupId: "dining",
        siteSubgroupId: "",
      }).leafCategoryId,
    ).toBe("dining");
  });

  it("rejects a group or subgroup from another branch", () => {
    expect(() =>
      resolveArticleCategorySelection(categories, {
        siteCategoryId: "root",
        siteGroupId: "lamps",
        siteSubgroupId: "",
      }),
    ).toThrow("ne pripada izabranoj kategoriji");
    expect(() =>
      resolveArticleCategorySelection(categories, {
        siteCategoryId: "root",
        siteGroupId: "dining",
        siteSubgroupId: "lamps",
      }),
    ).toThrow("ne pripada izabranoj grupi");
  });

  it("requires both category and group before the article can be saved", () => {
    expect(
      requiredArticleCategorySelectionError({
        siteCategoryId: "",
        siteGroupId: "",
      }),
    ).toContain("Kategorija je obavezna");
    expect(
      requiredArticleCategorySelectionError({
        siteCategoryId: "root",
        siteGroupId: "",
      }),
    ).toContain("Grupa je obavezna");
    expect(
      requiredArticleCategorySelectionError({
        siteCategoryId: "root",
        siteGroupId: "dining",
      }),
    ).toBeNull();
  });
});
