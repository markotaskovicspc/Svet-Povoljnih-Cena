import { describe, expect, it } from "vitest";
import { getCategoryMenuAction } from "@/components/layout/category-menu-action";

describe("category menu navigation", () => {
  it("opens the next menu level when a category has children", () => {
    expect(
      getCategoryMenuAction({
        children: [{ label: "Stone lampe", href: "/k/rasveta/stone-lampe" }],
      }),
    ).toBe("submenu");
  });

  it("navigates only when the category is a leaf", () => {
    expect(getCategoryMenuAction({ children: [] })).toBe("link");
    expect(getCategoryMenuAction({})).toBe("link");
  });
});
