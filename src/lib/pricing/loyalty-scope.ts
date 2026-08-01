export type ScopedLoyaltyRule = {
  id: string;
  discountPct: number;
  priority: number;
  updatedAt: string;
  scope: "SELECTED_PRODUCTS" | "ALL_PRODUCTS";
  productIds: string[];
};

/** Rules are already time/status filtered; this resolves product scope. */
export function selectApplicableLoyaltyRule(
  productId: string | undefined,
  rules: ScopedLoyaltyRule[],
) {
  return rules
    .filter(
      (rule) =>
        rule.scope === "ALL_PRODUCTS" ||
        Boolean(productId && rule.productIds.includes(productId)),
    )
    .sort((left, right) => {
      const priority = right.priority - left.priority;
      if (priority) return priority;
      const updated =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updated) return updated;
      return left.id.localeCompare(right.id);
    })[0] ?? null;
}
