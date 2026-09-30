import type { Product } from "@/types";
import { richTextPlainText } from "@/lib/rich-text";
import { formatProductCardDimensions } from "@/lib/product-dimensions";

export function seoPlainText(value: string | null | undefined) {
  return richTextPlainText(value ?? "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const point = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : entity;
    })
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPlaceholderDescription(value: string) {
  return /^(?:dopuniti opis(?: za sajt)?|opis uskoro|lorem ipsum)[.!\s]*$/i.test(seoPlainText(value));
}

/** Metadata uses structured facts; ERP shortDescription remains an item type. */
export function productSeoDescription(product: Pick<Product,
  "name" | "colorPrimary" | "dimensionsCm" | "attributes"
>) {
  const name = seoPlainText(product.name);
  const parts = [name.replace(/[.!?]+$/, "") + "."];
  const color = seoPlainText(product.colorPrimary);
  if (color && !name.toLocaleLowerCase("sr-Latn").includes(color.toLocaleLowerCase("sr-Latn"))) {
    parts.push(`Boja: ${color.toLocaleLowerCase("sr-Latn")}.`);
  }
  const dimensions = product.dimensionsCm && formatProductCardDimensions(product.dimensionsCm);
  if (dimensions) parts.push(`Dimenzije: ${dimensions}.`);
  // Free-form imported attributes need editorial verification (e.g. capacity can
  // contradict the declaration). Do not amplify them in automatic metadata.
  // Never cut a measurement or variant to fit a character quota.
  return parts.join(" ");
}

export type SeoCategory = { path: string; name: string; slug: string };

/** Earlier PDP links slugified display labels rather than using stored paths. */
export function legacyCategoryPath(labelSlug: string, categories: SeoCategory[]) {
  const matches = categories.filter(category => {
    const label = category.name.split(/\s*\/\s*/).at(-1) ?? "";
    const oldSlug = label.toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return oldSlug === labelSlug;
  });
  // Never guess between different categories with the same display name.
  return matches.length === 1 ? matches[0].path : null;
}

export function productCategoryTrail(paths: string[] | undefined, categories: SeoCategory[]) {
  const assigned = new Set(paths ?? []);
  const leaf = categories.filter(c => assigned.has(c.path))
    .sort((a, b) => b.path.split("/").length - a.path.split("/").length)[0];
  if (!leaf) return [];
  return categories
    .filter(c => c.path === leaf.path || leaf.path.startsWith(c.path.replace(/\/$/, "") + "/"))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)
    .map(c => ({ label: c.name, href: `/k/${c.path.replace(/^\/+/, "")}` }));
}

export function populatedCategoryPaths(products: Array<{ categories: Array<{ category: { path: string } }> }>) {
  const paths = new Set<string>();
  for (const product of products) for (const { category } of product.categories) {
    const segments = category.path.split("/").filter(Boolean);
    for (let end = 1; end <= segments.length; end++) paths.add("/" + segments.slice(0, end).join("/"));
  }
  return paths;
}
