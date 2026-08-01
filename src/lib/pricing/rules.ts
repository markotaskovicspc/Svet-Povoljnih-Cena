import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db, hasDatabaseConnection } from "@/lib/db";
import type { Product } from "@/types";
import { compareActionPriceCandidates } from "./engine";
import {
  selectApplicableLoyaltyRule,
  type ScopedLoyaltyRule,
} from "./loyalty-scope";

export type ActivePricingRules = {
  evaluatedAt: string;
  loyaltyRules: ScopedLoyaltyRule[];
  linearPromotions: Array<{
    id: string;
    name: string;
    discountPct: number;
    priority: number;
    startsAt: string;
    endsAt: string;
    categoryIds: string[];
    categoryPaths: string[];
    groupIds: string[];
  }>;
};

const emptyRules = (): ActivePricingRules => ({
  evaluatedAt: new Date().toISOString(),
  loyaltyRules: [],
  linearPromotions: [],
});

async function loadActivePricingRules(): Promise<ActivePricingRules> {
  if (!hasDatabaseConnection()) return emptyRules();

  const now = new Date();
  const liveWindow = {
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };

  const [loyaltyRules, linearPromotions] = await Promise.all([
    db.loyaltyRule.findMany({
      where: { active: true, ...liveWindow },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        discountPct: true,
        priority: true,
        updatedAt: true,
        scope: true,
        products: { select: { productId: true } },
      },
    }),
    db.linearPromotion.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      include: {
        categories: {
          select: {
            categoryId: true,
            category: { select: { path: true } },
          },
        },
        groups: { select: { groupId: true } },
      },
    }),
  ]);

  return {
    evaluatedAt: now.toISOString(),
    loyaltyRules: loyaltyRules.map((rule) => ({
      id: rule.id,
      discountPct: Number(rule.discountPct),
      priority: rule.priority,
      updatedAt: rule.updatedAt.toISOString(),
      scope: rule.scope,
      productIds: rule.products.map((item) => item.productId),
    })),
    linearPromotions: linearPromotions.map((promotion) => ({
      id: promotion.id,
      name: promotion.name,
      discountPct: Number(promotion.discountPct),
      priority: promotion.priority,
      startsAt: promotion.startsAt.toISOString(),
      endsAt: promotion.endsAt.toISOString(),
      categoryIds: promotion.categories.map((item) => item.categoryId),
      categoryPaths: promotion.categories.map((item) => item.category.path),
      groupIds: promotion.groups.map((item) => item.groupId),
    })),
  };
}

const getActivePricingRulesAcrossRequests = unstable_cache(
  loadActivePricingRules,
  ["active-pricing-rules-v3"],
  { revalidate: 30, tags: ["catalog-pricing"] },
);

export const getActivePricingRules = cache(getActivePricingRulesAcrossRequests);

export function pricingRuleInputsForProduct(
  product: {
    id?: string;
    categoryIds?: string[];
    categoryPaths?: string[];
    groupId?: string | null;
  },
  rules: ActivePricingRules,
) {
  const categoryIds = new Set(product.categoryIds ?? []);
  const categoryPaths = product.categoryPaths ?? [];
  const loyalty = selectApplicableLoyaltyRule(
    product.id,
    rules.loyaltyRules ?? [],
  );
  return {
    loyaltyDiscountPct: loyalty?.discountPct ?? null,
    linearPromotions: rules.linearPromotions
      .filter((promotion) => {
        const hasScope =
          promotion.categoryIds.length > 0 || promotion.groupIds.length > 0;
        if (!hasScope) return true;
        return (
          promotion.categoryIds.some((id) => categoryIds.has(id)) ||
          promotion.categoryPaths.some((selectedPath) =>
            categoryPaths.some(
              (productPath) =>
                productPath === selectedPath ||
                productPath.startsWith(`${selectedPath}/`),
            ),
          ) ||
          Boolean(product.groupId && promotion.groupIds.includes(product.groupId))
        );
      })
      .map((promotion) => ({
        name: promotion.name,
        discountPct: promotion.discountPct,
        priority: promotion.priority,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt,
      })),
  };
}

function isLive(
  startsAt: string,
  endsAt: string,
  now: Date,
  permanent = false,
) {
  if (permanent) return true;
  const time = now.getTime();
  return time >= new Date(startsAt).getTime() && time <= new Date(endsAt).getTime();
}

/**
 * Enriches a public catalog product with the globally active loyalty rule and
 * the linear promotions whose category/group scope contains that product.
 * Authentication is deliberately not read here because catalog responses are
 * shared; callers set `loyaltyEligible` from their request/session context.
 */
export function applyActivePricingRules(
  product: Product,
  rules: ActivePricingRules,
): Product {
  const ruleInputs = pricingRuleInputsForProduct(
    {
      id: product.id,
      categoryIds: product.categoryIds,
      categoryPaths: product.pricingCategoryPaths,
      groupId: product.groupId,
    },
    rules,
  );

  const evaluatedAt = new Date(rules.evaluatedAt);
  const canonicalAction = [...(product.actionPrices ?? [])]
    .filter((candidate) =>
      isLive(
        candidate.startsAt,
        candidate.endsAt,
        evaluatedAt,
        Boolean(candidate.isPermanent),
      ),
    )
    .sort(compareActionPriceCandidates)[0];

  return {
    ...product,
    loyaltyPrice: undefined,
    loyaltyDiscountPct: ruleInputs.loyaltyDiscountPct ?? undefined,
    linearPromotions: ruleInputs.linearPromotions,
    action: canonicalAction?.actionId
      ? {
          id: canonicalAction.actionId,
          name: canonicalAction.actionName ?? "Akcija",
          startsAt: canonicalAction.startsAt,
          endsAt: canonicalAction.endsAt,
          isHero: canonicalAction.isHero,
          isPermanent: canonicalAction.isPermanent,
        }
      : product.action,
  };
}
