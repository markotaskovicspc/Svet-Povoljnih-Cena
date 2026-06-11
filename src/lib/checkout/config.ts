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
import {
  ASSEMBLY_PRICE_DEFAULT,
  DEFAULT_DELIVERY_QUOTE,
  DEFAULT_PAYMENT_METHOD_CONFIG,
  DEFAULT_TRUCK_CITY_NAMES,
  SHIPPING_PRICES,
  type CheckoutConfig,
  type CheckoutDeliveryQuote,
  type CheckoutPaymentMethodConfig,
} from "./config-shared";

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
  categories: Array<{ categoryId: string }>;
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
    return {
      id: fallback.id,
      enabled: row?.enabled ?? fallback.enabled,
      label: row?.label?.trim() || fallback.label,
      note: row?.note ?? fallback.note,
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
}: {
  city?: string | null;
  lines?: QuoteLineInput[];
}): Promise<CheckoutDeliveryQuote> {
  const normalizedCity = normalizeCity(city);
  const skus = [...new Set(lines.map((line) => line.sku).filter(Boolean))];

  const [cityCount, cityRow, products, truckCities] = await Promise.all([
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
            categories: { select: { categoryId: true } },
          },
        })
      : Promise.resolve([]),
    db.deliveryCity.findMany({
      where: { truckEnabled: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
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
    pickRulePrice(rules, product, cityRow?.id ?? null, "courierPrice", SHIPPING_PRICES.kurir),
  );
  const truckPrices = quoteProducts.map((product) =>
    pickRulePrice(rules, product, cityRow?.id ?? null, "truckPrice", SHIPPING_PRICES.kamion),
  );
  const assemblyPrice = pickRulePrice(
    rules,
    null,
    cityRow?.id ?? null,
    "assemblyPrice",
    ASSEMBLY_PRICE_DEFAULT,
  );
  const assemblyPricesBySku = Object.fromEntries(
    lines.map((line) => {
      const product = productBySku.get(line.sku) ?? null;
      const price =
        product?.allowsAssembly === false
          ? 0
          : pickRulePrice(
              rules,
              product,
              cityRow?.id ?? null,
              "assemblyPrice",
              assemblyPrice,
            );
      return [line.sku, price] as const;
    }),
  ) as Partial<Record<SKU, number>>;
  const fallbackTruckCities = [...DEFAULT_TRUCK_CITY_NAMES];
  const databaseTruckCities = truckCities.map((row) => row.name);
  const effectiveTruckCities = databaseTruckCities.length
    ? databaseTruckCities
    : fallbackTruckCities;
  const truckAvailable =
    !normalizedCity ||
    (cityRow
      ? cityRow.truckEnabled
      : cityCount === 0 && fallbackTruckCities.some((name) => normalizeCity(name) === normalizedCity));

  return {
    prices: {
      kurir: normalizePrice(Math.max(...courierPrices), SHIPPING_PRICES.kurir),
      kamion: normalizePrice(Math.max(...truckPrices), SHIPPING_PRICES.kamion),
    },
    assemblyPrice: normalizePrice(assemblyPrice, DEFAULT_DELIVERY_QUOTE.assemblyPrice),
    assemblyPricesBySku,
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
  fallback: number,
) {
  const sorted = rules
    .filter((rule) => rule[field] != null && ruleAppliesToProduct(rule, product))
    .sort((a, b) => compareRules(a, b, cityId));
  const selected = sorted[0]?.[field];
  return selected == null ? fallback : normalizePrice(num(selected), fallback);
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
