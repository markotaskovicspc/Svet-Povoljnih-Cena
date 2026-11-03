import { expect, it } from "vitest";
import type { CategoryNode } from "@/lib/api/catalog";
import { categoryNav } from "@/lib/storefront/category-navigation";
import { legacyCategoryNavigationPath } from "@/lib/seo/catalog";

const root = { id: "appliances", name: "Mali kućni aparati", slug: "mali-kucni-aparati", path: "/mali-kucni-aparati", parentId: undefined, order: 0 };
const irons = { id: "irons", name: "Pegle i parne stanice", slug: "mali-kucni-aparati-pegle-i-parne-stanice", path: "/mali-kucni-aparati/pegle-i-parne-stanice", parentId: root.id, order: 0 };

it("uses canonical paths in the shared desktop/mobile menu despite prefixed import slugs", () => {
  const tree: CategoryNode[] = [{ ...root, children: [{ ...irons, imageUrl: "/irons.webp", children: [] }] }];
  expect(categoryNav(tree)).toEqual([{
    label: root.name, href: `/k${root.path}`, imageUrl: undefined,
    children: [{ label: irons.name, href: `/k${irons.path}`, imageUrl: "/irons.webp", children: undefined }],
  }]);
});

it("resolves the complete old menu URL to its canonical category", () => {
  expect(legacyCategoryNavigationPath(`/${root.slug}/${irons.slug}`, [root, irons])).toBe(irons.path);
});

it("also resolves old menu paths whose intermediate ancestor has an imported slug", () => {
  const child = { name: "Parne stanice", slug: "pegle-parne-stanice", path: `${irons.path}/parne-stanice` };
  expect(legacyCategoryNavigationPath(`/${root.slug}/${irons.slug}/${child.slug}`, [root, irons, child])).toBe(child.path);
});

it("rejects wrong parents, missing ancestors, extra segments and ambiguous matches", () => {
  expect(legacyCategoryNavigationPath(`/drugo/${irons.slug}`, [root, irons])).toBeNull();
  expect(legacyCategoryNavigationPath(`/${root.slug}/${irons.slug}`, [irons])).toBeNull();
  expect(legacyCategoryNavigationPath(`/${root.slug}/nepoznato/${irons.slug}`, [root, irons])).toBeNull();
  const duplicate = { ...irons, path: `${root.path}/druga-kategorija` };
  expect(legacyCategoryNavigationPath(`/${root.slug}/${irons.slug}`, [root, irons, duplicate])).toBeNull();
});
