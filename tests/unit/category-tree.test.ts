import { describe, expect, it } from "vitest";
import {
  categoryDescendantPathUpdates,
  categoryTreeDepth,
  collectCategoryDescendantIds,
  flattenCategoryTree,
  type CategoryTreeItem,
} from "@/lib/admin/category-tree";

function category(
  values: Partial<CategoryTreeItem> & Pick<CategoryTreeItem, "id" | "name">,
): CategoryTreeItem {
  return {
    slug: values.id,
    parentId: null,
    order: 0,
    path: `/${values.id}`,
    level: 0,
    ...values,
  };
}

describe("category tree", () => {
  it("keeps descendants with their parent and sorts every sibling group by order", () => {
    const rows = [
      category({ id: "root-b", name: "B", order: 2 }),
      category({ id: "child-b", name: "Child B", parentId: "root-a", order: 5, level: 1 }),
      category({ id: "root-a", name: "A", order: 1 }),
      category({ id: "child-a", name: "Child A", parentId: "root-a", order: 1, level: 1 }),
    ];

    expect(
      flattenCategoryTree(rows).map(({ id, indent }) => [id, indent]),
    ).toEqual([
      ["root-a", 0],
      ["child-a", 1],
      ["child-b", 1],
      ["root-b", 0],
    ]);
  });

  it("finds every descendant so a category cannot be moved into its own subtree", () => {
    const rows = [
      category({ id: "root", name: "Root" }),
      category({ id: "child", name: "Child", parentId: "root" }),
      category({ id: "grandchild", name: "Grandchild", parentId: "child" }),
    ];

    expect([...collectCategoryDescendantIds(rows, "root")].sort()).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("rebuilds paths and levels for the complete changed subtree", () => {
    const rows = [
      category({ id: "root", name: "Root", slug: "new-root", path: "/new-root" }),
      category({ id: "child", name: "Child", slug: "child", parentId: "root", path: "/old-root/child", level: 1 }),
      category({ id: "grandchild", name: "Grandchild", slug: "grandchild", parentId: "child", path: "/old-root/child/grandchild", level: 2 }),
    ];

    expect(categoryDescendantPathUpdates(rows, "root")).toEqual([
      { id: "child", path: "/new-root/child", level: 1 },
      { id: "grandchild", path: "/new-root/child/grandchild", level: 2 },
    ]);
  });

  it("calculates depth from parent relations instead of stale level values", () => {
    const rows = [
      category({ id: "root", name: "Root", level: 9 }),
      category({ id: "group", name: "Group", parentId: "root", level: 0 }),
      category({ id: "subgroup", name: "Subgroup", parentId: "group", level: 1 }),
    ];

    expect(categoryTreeDepth(rows, "root")).toBe(0);
    expect(categoryTreeDepth(rows, "group")).toBe(1);
    expect(categoryTreeDepth(rows, "subgroup")).toBe(2);
  });
});
