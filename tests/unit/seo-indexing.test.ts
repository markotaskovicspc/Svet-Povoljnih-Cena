import { beforeEach, expect, it, vi } from "vitest";
import { landingIsIndexable } from "@/lib/seo/landing";

const mocks = vi.hoisted(() => ({
  path: vi.fn(), slug: vi.fn(), catalog: vi.fn(), redirect: vi.fn(), list: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  permanentRedirect: mocks.redirect,
}));
vi.mock("@/components/listing/listing-shell", () => ({ ListingShell: () => null }));
vi.mock("@/lib/api/catalog", () => ({
  getCategoryByPath: mocks.path, getCategoryBySlug: mocks.slug, listProducts: mocks.list,
}));
vi.mock("@/lib/seo/catalog.server", () => ({ getSeoCatalog: mocks.catalog }));
vi.mock("@/lib/storefront/content", () => ({ getTabTitleIcon: vi.fn() }));
import CategoryPage, { generateMetadata } from "@/app/(shop)/k/[...slug]/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.path.mockResolvedValue(null);
  mocks.slug.mockResolvedValue({ name: "Radna soba", slug: "radna-soba", path: "/namestaj/radna-soba" });
  mocks.catalog.mockResolvedValue({ categories: [], products: [] });
  mocks.redirect.mockImplementation((url) => { throw new Error(`REDIRECT:${url}`); });
});

it("redirects the old prefixed menu URL before querying products", async () => {
  const root = { name: "Mali kućni aparati", slug: "mali-kucni-aparati", path: "/mali-kucni-aparati" };
  const category = { name: "Pegle i parne stanice", slug: "mali-kucni-aparati-pegle-i-parne-stanice", path: `${root.path}/pegle-i-parne-stanice` };
  mocks.path.mockImplementation(async path => path === category.path ? category : null);
  mocks.catalog.mockResolvedValue({ categories: [root, category], products: [] });
  const params = Promise.resolve({ slug: [root.slug, category.slug] });
  await expect(CategoryPage({ params })).rejects.toThrow(`REDIRECT:/k${category.path}`);
  expect(mocks.list).not.toHaveBeenCalled();
  expect((await generateMetadata({ params })).alternates?.canonical).toBe(`/k${category.path}`);
});

it("serves the canonical category and queries products with its stored path", async () => {
  const category = { name: "Pegle i parne stanice", path: "/mali-kucni-aparati/pegle-i-parne-stanice" };
  mocks.path.mockResolvedValue(category);
  mocks.list.mockResolvedValue({ items: [], total: 3, nextCursor: null });
  const page = await CategoryPage({ params: Promise.resolve({ slug: ["mali-kucni-aparati", "pegle-i-parne-stanice"] }) });
  expect(mocks.redirect).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ categoryPath: category.path }));
  expect(page.props.title).toBe(category.name);
  expect(page.props.total).toBe(3);
});

it("keeps an unknown parent path as a 404 instead of matching only the leaf slug", async () => {
  const root = { name: "Mali kućni aparati", slug: "mali-kucni-aparati", path: "/mali-kucni-aparati" };
  const category = { name: "Pegle i parne stanice", slug: "mali-kucni-aparati-pegle-i-parne-stanice", path: `${root.path}/pegle-i-parne-stanice` };
  mocks.catalog.mockResolvedValue({ categories: [root, category], products: [] });
  await expect(CategoryPage({ params: Promise.resolve({ slug: ["pogresno", category.slug] }) })).rejects.toThrow("NOT_FOUND");
  expect(mocks.redirect).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});

it("redirects old short category URLs to the real path before loading products", async () => {
  await expect(CategoryPage({ params: Promise.resolve({ slug: ["radna-soba"] }) }))
    .rejects.toThrow("REDIRECT:/k/namestaj/radna-soba");
  expect(mocks.list).not.toHaveBeenCalled();
});

it("keeps empty categories usable but out of the index", async () => {
  mocks.path.mockResolvedValue({ name: "Radna soba", path: "/namestaj/radna-soba" });
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: ["namestaj", "radna-soba"] }) });
  expect(metadata.alternates?.canonical).toBe("/k/namestaj/radna-soba");
  expect(metadata.robots).toEqual({ index: false, follow: true });
});

it("repairs display-name links even when the current category slug is different", async () => {
  const category = {name:'Radna soba',slug:'kancelarija-i-gejming',path:'/namestaj/kancelarija-i-gejming'};
  mocks.path.mockImplementation(async path => path===category.path ? category : null);
  mocks.slug.mockResolvedValue(null);
  mocks.catalog.mockResolvedValue({categories:[category], products:[]});
  await expect(CategoryPage({params:Promise.resolve({slug:['radna-soba']})}))
    .rejects.toThrow('REDIRECT:/k/namestaj/kancelarija-i-gejming');
});

it("does not misclassify a database failure as an empty category", async () => {
  mocks.catalog.mockRejectedValue(new Error("database offline"));
  await expect(generateMetadata({ params: Promise.resolve({ slug: ["radna-soba"] }) }))
    .rejects.toThrow("database offline");
});

it("excludes empty or unpublished-product landing lists, preserving real editorial pages", () => {
  const list = { template: "SIMPLE_PRODUCT_LIST" as const, robotsIndex: true, productSkus: ["hidden"] };
  expect(landingIsIndexable(list, new Set(["live"]))).toBe(false);
  expect(landingIsIndexable({ ...list, productSkus: [] })).toBe(false);
  expect(landingIsIndexable({ ...list, productSkus: ["live"] }, new Set(["live"]))).toBe(true);
  expect(landingIsIndexable({ ...list, template: "BUILDER" })).toBe(true);
  expect(landingIsIndexable({ ...list, template: "BUILDER", robotsIndex: false })).toBe(false);
});
