import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import { db, hasDatabaseConnection } from "@/lib/db";
import type { DeliveryTariffRates } from "@/lib/delivery-tariff";

export const DELIVERY_TARIFF_SETTING_KEY = "delivery.tariff";

const priceSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce
    .number()
    .int("Cena mora biti ceo broj dinara.")
    .min(0, "Cena ne može biti negativna.")
    .max(1_000_000, "Cena je previsoka."),
);

const baseCategorySchema = z.object({
  upTo5Kg: priceSchema,
  upTo10Kg: priceSchema,
  upTo20Kg: priceSchema,
  upTo30Kg: priceSchema,
});

const categoryOneSchema = baseCategorySchema.extend({
  over30Kg: priceSchema,
});

const categoryTwoSchema = baseCategorySchema.extend({
  upTo50Kg: priceSchema,
  upTo70Kg: priceSchema,
  upTo100Kg: priceSchema,
  over100Kg: priceSchema,
});

export const deliveryTariffSettingsSchema = z.object({
  category1: categoryOneSchema,
  category2: categoryTwoSchema,
});

export type DeliveryTariffSettings = z.infer<
  typeof deliveryTariffSettingsSchema
>;

export const DEFAULT_DELIVERY_TARIFF_SETTINGS: DeliveryTariffSettings = {
  category1: {
    upTo5Kg: 299,
    upTo10Kg: 399,
    upTo20Kg: 599,
    upTo30Kg: 899,
    over30Kg: 999,
  },
  category2: {
    upTo5Kg: 699,
    upTo10Kg: 799,
    upTo20Kg: 999,
    upTo30Kg: 1_299,
    upTo50Kg: 1_499,
    upTo70Kg: 1_699,
    upTo100Kg: 1_899,
    over100Kg: 2_099,
  },
};

async function loadDeliveryTariffSettings(): Promise<DeliveryTariffSettings> {
  if (!hasDatabaseConnection()) return DEFAULT_DELIVERY_TARIFF_SETTINGS;
  const setting = await db.adminSetting.findUnique({
    where: { key: DELIVERY_TARIFF_SETTING_KEY },
    select: { value: true },
  });
  const parsed = deliveryTariffSettingsSchema.safeParse(setting?.value);
  return parsed.success ? parsed.data : DEFAULT_DELIVERY_TARIFF_SETTINGS;
}

const getCachedDeliveryTariffSettings = unstable_cache(
  loadDeliveryTariffSettings,
  [DELIVERY_TARIFF_SETTING_KEY],
  { revalidate: 60, tags: [DELIVERY_TARIFF_SETTING_KEY] },
);

export function getDeliveryTariffSettings() {
  return getCachedDeliveryTariffSettings();
}

export function deliveryTariffRatesFromSettings(
  settings: DeliveryTariffSettings,
): DeliveryTariffRates {
  return {
    1: [
      [5, settings.category1.upTo5Kg],
      [10, settings.category1.upTo10Kg],
      [20, settings.category1.upTo20Kg],
      [30, settings.category1.upTo30Kg],
      [Number.POSITIVE_INFINITY, settings.category1.over30Kg],
    ],
    2: [
      [5, settings.category2.upTo5Kg],
      [10, settings.category2.upTo10Kg],
      [20, settings.category2.upTo20Kg],
      [30, settings.category2.upTo30Kg],
      [50, settings.category2.upTo50Kg],
      [70, settings.category2.upTo70Kg],
      [100, settings.category2.upTo100Kg],
      [Number.POSITIVE_INFINITY, settings.category2.over100Kg],
    ],
  };
}
