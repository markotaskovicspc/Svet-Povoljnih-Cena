import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryMenuGrid } from "@/components/layout/category-menu-grid";
import { MobileCategoryLevel } from "@/components/layout/mobile-category-level";
import type { NavNode } from "@/data/site";

const categories: NavNode[] = [
  {
    label: "Nameštaj",
    href: "/k/namestaj",
    imageUrl: "/placeholder.svg",
    children: [{ label: "Stolice", href: "/k/namestaj/stolice" }],
  },
  {
    label: "Sve za kuću",
    href: "/k/sve-za-kucu",
    imageUrl: "/placeholder.svg",
  },
];

describe("storefront category menu presentation", () => {
  it("uses one black-label tile grid for mobile and desktop menus", () => {
    const onEnter = vi.fn();
    const onNavigate = vi.fn();
    const html = renderToStaticMarkup(
      <CategoryMenuGrid
        categories={categories}
        onEnter={onEnter}
        onNavigate={onNavigate}
      />,
    );

    expect(html).toContain('data-slot="category-menu-grid"');
    expect(html).toContain("grid-cols-2");
    expect(html.match(/text-black/g)).toHaveLength(2);
    expect(html).not.toContain("text-ink-800");
    expect(html).toContain("<button");
    expect(html).toContain('href="/k/sve-za-kucu"');
  });

  it("matches the compact mobile drill-down category layout", () => {
    const html = renderToStaticMarkup(
      <MobileCategoryLevel
        category={categories[0]}
        pathname="/k/namestaj/stolice"
        onBack={vi.fn()}
        onEnter={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(html).toContain('data-slot="mobile-category-level"');
    expect(html).toContain("Nameštaj");
    expect(html).toContain("uppercase");
    expect(html).toContain("Pogledaj sve");
    expect(html).toContain('href="/k/namestaj"');
    expect(html).toContain('href="/k/namestaj/stolice"');
    expect(html).toContain("h-8 w-11");
    expect(html).toContain("object-contain");
    expect(html).not.toContain("Povratak na glavni meni");
  });
});
