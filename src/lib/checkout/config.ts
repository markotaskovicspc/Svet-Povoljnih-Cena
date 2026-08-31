import "server-only";

import {
  DeliveryScope,
  PaymentMethod as DbPaymentMethodEnum,
  Prisma,
  type PaymentMethod as DbPaymentMethod,
} from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import type { PaymentMethod as ClientPaymentMethod, SKU } from "@/types";
import { getPaymentMethodAcceptance } from "@/lib/provider-acceptance";
import {
  ASSEMBLY_PRICE_DEFAULT,
  ASSEMBLY_ENABLED,
  DEFAULT_PAYMENT_METHOD_CONFIG,
  DEFAULT_TRUCK_CITY_NAMES,
  resolveDeliveryMethodQuote,
  TRUCK_DELIVERY_ENABLED,
  type CheckoutConfig,
  type CheckoutDeliveryQuote,
  type CheckoutPaymentMethodConfig,
} from "./config-shared";
import {
  calculatePublishedDeliveryTariffQuote,
  productDeliveryCategory,
} from "@/lib/delivery-tariff";
import {
  deliveryTariffRatesFromSettings,
  getDeliveryTariffSettings,
} from "@/lib/delivery-tariff-settings";
import { effectiveUnitPrice } from "@/lib/pricing";
import {
  getActivePricingRules,
  pricingRuleInputsForProduct,
} from "@/lib/pricing/rules";

const PAYMENT_TO_CLIENT = {
  IPS: "ips",
  KARTICA: "kartica",
  GOOGLE_PAY: "google_pay",
  APPLE_PAY: "apple_pay",
  UPLATA_NA_RACUN: "uplata_na_racun",
  POUZECE_GOTOVINA: "pouzece_gotovina",
  POUZECE_KARTICA: "pouzece_kartica",
} as const satisfies Record<DbPaymentMethod, ClientPaymentMethod>;

const CLIENT_TO_PAYMENT = Object.fromEntries(
  Object.entries(PAYMENT_TO_CLIENT).map(([dbMethod, clientMethod]) => [
    clientMethod,
    dbMethod,
  ]),
) as Record<ClientPaymentMethod, DbPaymentMethod>;

type QuoteLineInput = {
  sku: string;
  qty?: number;
};

type QuoteProduct = {
  id: string;
  sku: string;
  allowsAssembly: boolean;
  categories: Array<{ categoryId: string; category: { path: string } }>;
  groupId: string | null;
  fullPrice: Prisma.Decimal;
  salePrice: Prisma.Decimal | null;
  discountPct: number | null;
  action: {
    name: string;
    startsAt: Date;
    endsAt: Date;
    isPermanent: boolean;
  } | null;
  actionPrices: Array<{
    salePrice: Prisma.Decimal;
    action: {
      id: string;
      name: string;
      priority: number;
      startsAt: Date;
      endsAt: Date;
      isPermanent: boolean;
    };
  }>;
  packQty: number | null;
  unitPackWidthCm: Prisma.Decimal | null;
  unitPackDepthCm: Prisma.Decimal | null;
  unitPackHeightCm: Prisma.Decimal | null;
  packWidthCm: Prisma.Decimal | null;
  packDepthCm: Prisma.Decimal | null;
  packHeightCm: Prisma.Decimal | null;
  packGrossWeightKg: Prisma.Decimal | null;
  grossWeightKg: Prisma.Decimal | null;
  weightKg: Prisma.Decimal | null;
  priceListEntries: Array<{ price: Prisma.Decimal }>;
};

type DeliveryRule = {
  scope: DeliveryScope;
  categoryId: string | null;
  productId: string | null;
  cityId: string | null;
  courierPrice: Prisma.Decimal | null;
  truckPrice: Prisma.Decimal | null;
  assemblyPrice: Prisma.Decimal | null;
  updatedAt: Date;
};

export function paymentMethodToClient(method: DbPaymentMethod): ClientPaymentMethod {
  return PAYMENT_TO_CLIENT[method];
}

export function clientPaymentMethodToDb(method: ClientPaymentMethod): DbPaymentMethod {
  return CLIENT_TO_PAYMENT[method];
}

export async function getCheckoutPaymentMethods({
  enabledOnly = true,
}: {
  enabledOnly?: boolean;
} = {}): Promise<CheckoutPaymentMethodConfig[]> {
  const rows = await db.paymentMethodConfig.findMany();
  const byMethod = new Map(rows.map((row) => [paymentMethodToClient(row.method), row]));
  const methods = DEFAULT_PAYMENT_METHOD_CONFIG.map((fallback) => {
    const row = byMethod.get(fallback.id);
    const dbMethod = clientPaymentMethodToDb(fallback.id);
    const acceptance = getPaymentMethodAcceptance(dbMethod);
    return {
      id: fallback.id,
      enabled: (row?.enabled ?? fallback.enabled) && acceptance.accepted,
      label: row?.label?.trim() || fallback.label,
      note:
        row?.note ??
        (acceptance.accepted
          ? fallback.note
          : `${acceptance.requirement} još nije potvrđen.`),
    };
  });

  return enabledOnly ? methods.filter((method) => method.enabled) : methods;
}

export async function getCheckoutConfig(): Promise<CheckoutConfig> {
  const allPaymentMethods = await getCheckoutPaymentMethods({ enabledOnly: false });
  const enabledPaymentMethods = allPaymentMethods.filter((method) => method.enabled);
  return {
    paymentMethods: enabledPaymentMethods,
    defaultPaymentMethod: defaultPaymentMethod(enabledPaymentMethods),
    deliveryQuote: await resolveDeliveryQuote({ lines: [] }),
  };
}

export async function isPaymentMethodEnabled(method: DbPaymentMethod) {
  const configured = await getCheckoutPaymentMethods({ enabledOnly: false });
  const clientMethod = paymentMethodToClient(method);
  return configured.some((item) => item.id === clientMethod && item.enabled);
}

export async function resolveDeliveryQuote({
  city,
  lines = [],
  loggedIn = false,
}: {
  city?: string | null;
  lines?: QuoteLineInput[];
  loggedIn?: boolean;
}): Promise<CheckoutDeliveryQuote> {
  const now = new Date();
  const normalizedCity = normalizeCity(city);
  const skus = [...new Set(lines.map((line) => line.sku).filter(Boolean))];

  const [
    cityCount,
    cityRow,
    products,
    truckCities,
    activePricingRules,
    deliveryTariffSettings,
  ] = await Promise.all([
    db.deliveryCity.count(),
    normalizedCity
      ? db.deliveryCity.findFirst({
          where: { name: { equals: city?.trim(), mode: "insensitive" } },
          select: { id: true, name: true, truckEnabled: true },
        })
      : Promise.resolve(null),
    skus.length
      ? db.product.findMany({
          where: { sku: { in: skus } },
          select: {
            id: true,
            sku: true,
            allowsAssembly: true,
            categories: {
              select: {
                categoryId: true,
                category: { select: { path: true } },
              },
            },
            groupId: true,
            fullPrice: true,
            salePrice: true,
            discountPct: true,
            action: {
              select: {
                name: true,
                startsAt: true,
                endsAt: true,
                isPermanent: true,
              },
            },
            actionPrices: {
              include: {
                action: {
                  select: {
                    id: true,
                    name: true,
                    priority: true,
                    startsAt: true,
                    endsAt: true,
                    isPermanent: true,
                  },
                },
              },
            },
            packQty: true,
            unitPackWidthCm: true,
            unitPackDepthCm: true,
            unitPackHeightCm: true,
            packWidthCm: true,
            packDepthCm: true,
            packHeightCm: true,
            packGrossWeightKg: true,
            grossWeightKg: true,
            weightKg: true,
            priceListEntries: {
              where: {
                price: { gt: 0 },
                validFrom: { lte: now },
                OR: [{ validTo: null }, { validTo: { gte: now } }],
                priceList: { kind: "RETAIL", active: true },
              },
              orderBy: { validFrom: "desc" },
              take: 1,
              select: { price: true },
            },
          },
        })
      : Promise.resolve([]),
    db.deliveryCity.findMany({
      where: { truckEnabled: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    getActivePricingRules(),
    getDeliveryTariffSettings(),
  ]);

  const productIds = products.map((product) => product.id);
  const categoryIds = [
    ...new Set(products.flatMap((product) => product.categories.map((c) => c.categoryId))),
  ];
  const scopeFilters = [
    { scope: DeliveryScope.GLOBAL },
    ...(productIds.length
      ? [{ scope: DeliveryScope.PRODUCT, productId: { in: productIds } }]
      : []),
    ...(categoryIds.length
      ? [{ scope: DeliveryScope.CATEGORY, categoryId: { in: categoryIds } }]
      : []),
  ];
  const cityFilters = cityRow
    ? [{ cityId: cityRow.id }, { cityId: null }]
    : [{ cityId: null }];
  const rules = await db.deliveryPriceRule.findMany({
    where: { AND: [{ OR: scopeFilters }, { OR: cityFilters }] },
    orderBy: { updatedAt: "desc" },
  });
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const quoteProducts = lines.length
    ? lines.map((line) => productBySku.get(line.sku) ?? null)
    : [null];
  const courierPrices = quoteProducts.map((product) =>
    pickRulePrice(rules, product, cityRow?.id ?? null, "courierPrice"),
  );
  const truckPrices = quoteProducts.map((product) =>
    pickRulePrice(rules, product, cityRow?.id ?? null, "truckPrice"),
  );
  const configuredCourierPrice = combinedConfiguredPrice(courierPrices);
  const configuredTruckPrice = combinedConfiguredPrice(truckPrices);
  const assemblyPrice =
    pickRulePrice(rules, null, cityRow?.id ?? null, "assemblyPrice") ??
    ASSEMBLY_PRICE_DEFAULT;
  const assemblyPricesBySku = Object.fromEntries(
    lines.map((line) => {
      const product = productBySku.get(line.sku) ?? null;
      const price =
        !ASSEMBLY_ENABLED || product?.allowsAssembly === false
          ? 0
          : pickRulePrice(
              rules,
              product,
              cityRow?.id ?? null,
              "assemblyPrice",
            ) ?? assemblyPrice;
      return [line.sku, price] as const;
    }),
  ) as Partial<Record<SKU, number>>;
  const fallbackTruckCities = [...DEFAULT_TRUCK_CITY_NAMES];
  const databaseTruckCities = truckCities.map((row) => row.name);
  const effectiveTruckCities = TRUCK_DELIVERY_ENABLED
    ? databaseTruckCities.length
      ? databaseTruckCities
      : fallbackTruckCities
    : [];
  const truckAvailable =
    TRUCK_DELIVERY_ENABLED &&
    (!normalizedCity ||
      (cityRow
        ? cityRow.truckEnabled
        : cityCount === 0 && fallbackTruckCities.some((name) => normalizeCity(name) === normalizedCity)));

  const publishedTariffLines = lines.flatMap((line) => {
          const product = productBySku.get(line.sku);
          if (!product) return [];
          const ruleInputs = pricingRuleInputsForProduct(
            {
              id: product.id,
              categoryIds: product.categories.map((item) => item.categoryId),
              categoryPaths: product.categories.map((item) => item.category.path),
              groupId: product.groupId,
            },
            activePricingRules,
          );
          const unitPrice = effectiveUnitPrice({
            fullPrice: num(product.priceListEntries[0]?.price ?? product.fullPrice),
            salePrice: product.salePrice == null ? null : num(product.salePrice),
            discountPct: product.discountPct,
            loyaltyDiscountPct: ruleInputs.loyaltyDiscountPct,
            loyaltyEligible: loggedIn,
            action: product.action,
            actionPrices: product.actionPrices.map((entry) => ({
              price: num(entry.salePrice),
              priority: entry.action.priority,
              startsAt: entry.action.startsAt,
              endsAt: entry.action.endsAt,
              isPermanent: entry.action.isPermanent,
              actionId: entry.action.id,
              actionName: entry.action.name,
            })),
            linearPromotions: ruleInputs.linearPromotions,
          }).effective;
          return [{
            qty: Math.max(1, line.qty ?? 1),
            unitPrice,
            packQty: product.packQty,
            unitPackWidthCm:
              product.unitPackWidthCm == null ? null : num(product.unitPackWidthCm),
            unitPackDepthCm:
              product.unitPackDepthCm == null ? null : num(product.unitPackDepthCm),
            unitPackHeightCm:
              product.unitPackHeightCm == null ? null : num(product.unitPackHeightCm),
            packWidthCm: product.packWidthCm == null ? null : num(product.packWidthCm),
            packDepthCm: product.packDepthCm == null ? null : num(product.packDepthCm),
            packHeightCm: product.packHeightCm == null ? null : num(product.packHeightCm),
            packGrossWeightKg:
              product.packGrossWeightKg == null
                ? null
                : num(product.packGrossWeightKg),
            grossWeightKg:
              product.grossWeightKg == null ? null : num(product.grossWeightKg),
            weightKg: product.weightKg == null ? null : num(product.weightKg),
          }];
        });
  const publishedTariff =
    lines.length && publishedTariffLines.length === lines.length
      ? calculatePublishedDeliveryTariffQuote(publishedTariffLines, {
          loggedIn,
          rates: deliveryTariffRatesFromSettings(deliveryTariffSettings),
          at: now,
        })
      : null;
  const resolvedDelivery = resolveDeliveryMethodQuote({
    publishedTariff,
    configuredCourierPrice,
    configuredTruckPrice,
    truckAvailable,
  });
  const deliveryCategoriesBySku = Object.fromEntries(
    products.flatMap((product) => {
      const category = productDeliveryCategory({
        unitPackWidthCm:
          product.unitPackWidthCm == null ? null : num(product.unitPackWidthCm),
        unitPackDepthCm:
          product.unitPackDepthCm == null ? null : num(product.unitPackDepthCm),
        unitPackHeightCm:
          product.unitPackHeightCm == null ? null : num(product.unitPackHeightCm),
      });
      return category ? [[product.sku, category] as const] : [];
    }),
  ) as CheckoutDeliveryQuote["deliveryCategoriesBySku"];

  return {
    prices: resolvedDelivery.prices,
    recommendedMethod: resolvedDelivery.recommendedMethod,
    pricingIssue: lines.length ? resolvedDelivery.pricingIssue : null,
    deliveryCategoriesBySku,
    deliveryCategoryBreakdown: resolvedDelivery.deliveryCategoryBreakdown,
    assemblyPrice: ASSEMBLY_ENABLED
      ? normalizePrice(assemblyPrice, ASSEMBLY_PRICE_DEFAULT)
      : 0,
    assemblyPricesBySku: ASSEMBLY_ENABLED ? assemblyPricesBySku : {},
    truckAvailable,
    truckCities: effectiveTruckCities,
  };
}

function defaultPaymentMethod(
  methods: CheckoutPaymentMethodConfig[],
): ClientPaymentMethod {
  return (
    methods.find((method) => method.id === "pouzece_gotovina")?.id ??
    methods[0]?.id ??
    "pouzece_gotovina"
  );
}

function normalizeCity(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("sr-Latn-RS") ?? "";
}

function pickRulePrice(
  rules: DeliveryRule[],
  product: QuoteProduct | null,
  cityId: string | null,
  field: "courierPrice" | "truckPrice" | "assemblyPrice",
) {
  const sorted = rules
    .filter((rule) => rule[field] != null && ruleAppliesToProduct(rule, product))
    .sort((a, b) => compareRules(a, b, cityId));
  const selected = sorted[0]?.[field];
  return selected == null ? null : normalizePrice(num(selected), 0);
}

function combinedConfiguredPrice(prices: Array<number | null>) {
  const configured = prices.filter((price): price is number => price != null);
  if (!configured.length || configured.length !== prices.length) return null;
  return Math.max(...configured);
}

function ruleAppliesToProduct(rule: DeliveryRule, product: QuoteProduct | null) {
  if (rule.scope === DeliveryScope.GLOBAL) return true;
  if (!product) return false;
  if (rule.scope === DeliveryScope.PRODUCT) return rule.productId === product.id;
  if (rule.scope === DeliveryScope.CATEGORY) {
    return product.categories.some((category) => category.categoryId === rule.categoryId);
  }
  return false;
}

function compareRules(a: DeliveryRule, b: DeliveryRule, cityId: string | null) {
  const cityDiff = ruleCityScore(b, cityId) - ruleCityScore(a, cityId);
  if (cityDiff) return cityDiff;
  const scopeDiff = scopeScore(b.scope) - scopeScore(a.scope);
  if (scopeDiff) return scopeDiff;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

function ruleCityScore(rule: DeliveryRule, cityId: string | null) {
  return cityId && rule.cityId === cityId ? 1 : 0;
}

function scopeScore(scope: DeliveryScope) {
  switch (scope) {
    case DeliveryScope.PRODUCT:
      return 3;
    case DeliveryScope.CATEGORY:
      return 2;
    case DeliveryScope.GLOBAL:
      return 1;
  }
}

function normalizePrice(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const DB_PAYMENT_METHODS = Object.values(DbPaymentMethodEnum);
