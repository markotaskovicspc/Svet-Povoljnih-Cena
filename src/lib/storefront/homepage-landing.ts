import type { LandingPageSnapshot } from "@/lib/landing-pages/blocks";

const DATABASE_LANDING_PAGE_PREFIX = "landing:";

export function databaseLandingPageKey(id: string) {
  return `${DATABASE_LANDING_PAGE_PREFIX}${id}`;
}

export function databaseLandingPageId(key: string | null | undefined) {
  if (!key?.startsWith(DATABASE_LANDING_PAGE_PREFIX)) return null;
  const id = key.slice(DATABASE_LANDING_PAGE_PREFIX.length).trim();
  return id || null;
}

export function landingPageProductSkus(snapshot: LandingPageSnapshot) {
  const skus = snapshot.template === "SIMPLE_PRODUCT_LIST"
    ? snapshot.productSkus
    : snapshot.blocks.flatMap((block) =>
        block.visible && block.type === "PRODUCT_GRID"
          ? block.productSkus
          : [],
      );

  return Array.from(new Set(skus.map((sku) => sku.trim()).filter(Boolean)));
}
