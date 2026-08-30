import type { RabaluxCatalogItem } from "./types";

type RabaluxDescriptionSource = Pick<
  RabaluxCatalogItem,
  "type" | "category"
>;

/**
 * The ERP short description is part of the composed article name and sales
 * documents, so a supplier's long marketing paragraph does not belong there.
 * Prefer the most specific supplier classification and keep the full prose in
 * Product.description.
 */
export function rabaluxShortDescription(
  item: RabaluxDescriptionSource,
): string | null {
  return normalize(item.type) || normalize(item.category) || null;
}

function normalize(value: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
