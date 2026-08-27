export type RecommendationCartProduct = {
  id: string;
  sku: string;
  groupId: string | null;
};

export type ScopedRecommendationRule = {
  id: string;
  groupId: string | null;
  sourceProductId: string | null;
  order: number;
};

/**
 * An exact product rule overrides its broader group rule. The cart SKU order
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
    const exact = orderedRules.filter(
      (rule) => rule.sourceProductId === cartProduct.id,
    );
    const matching = exact.length
      ? exact
      : orderedRules.filter(
          (rule) =>
            rule.sourceProductId === null &&
            cartProduct.groupId !== null &&
            rule.groupId === cartProduct.groupId,
        );

    for (const rule of matching) {
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      selected.push(rule);
    }
  }

  return selected;
}
