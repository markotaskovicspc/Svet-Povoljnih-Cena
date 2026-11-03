export type RecommendationCartProduct = {
  id: string;
  sku: string;
  groupId: string | null;
  categoryPaths?: string[];
};

export type ScopedRecommendationRule = {
  id: string;
  groupId: string | null;
  sourceProductId: string | null;
  order: number;
  category?: { path: string } | null;
};

export function recommendationRuleMatchesProduct(
  product: RecommendationCartProduct,
  rule: ScopedRecommendationRule,
): boolean {
  if (rule.sourceProductId !== null) return rule.sourceProductId === product.id;
  if (rule.groupId !== null) return rule.groupId === product.groupId;
  const path = rule.category?.path;
  return Boolean(path && product.categoryPaths?.some(
    (productPath) => productPath === path || productPath.startsWith(`${path}/`),
  ));
}

/**
 * Product rules override group rules, then the deepest matching category.
 * Matching category paths use a segment boundary, including descendants.
 * The cart SKU order
 * remains authoritative and every rule is returned at most once.
 */
export function selectCartRecommendationRules<
  Rule extends ScopedRecommendationRule,
>(cartProducts: RecommendationCartProduct[], rules: Rule[]): Rule[] {
  const orderedRules = [...rules].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  const selected: Rule[] = [];
  const seen = new Set<string>();

  for (const cartProduct of cartProducts) {
    const applicable = orderedRules.filter(rule => recommendationRuleMatchesProduct(cartProduct, rule));
    const exact = applicable.filter(rule => rule.sourceProductId !== null);
    const groups = applicable.filter(rule => rule.sourceProductId === null && rule.groupId !== null);
    const categories = applicable.filter(rule => rule.sourceProductId === null && rule.groupId === null);
    const depth = Math.max(0, ...categories.map(rule => rule.category?.path.split("/").filter(Boolean).length ?? 0));
    const matching = exact.length ? exact : groups.length ? groups : categories.filter(
      rule => rule.category?.path.split("/").filter(Boolean).length === depth,
    );

    for (const rule of matching) {
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      selected.push(rule);
    }
  }

  return selected;
}
