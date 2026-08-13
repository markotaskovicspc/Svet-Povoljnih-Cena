import { z } from "zod";
import { normalizeMobileShortcutHref } from "@/lib/mobile-shortcuts/shared";

export const MOBILE_SEARCH_SETTING_KEY = "content.mobileSearch";
export const MOBILE_SEARCH_CURRENT_COUNT = 2;
export const MOBILE_SEARCH_PRODUCT_COUNT = 4;
export const MOBILE_SEARCH_QUERY_COUNT = 6;

export const DEFAULT_MOBILE_SEARCH_QUERIES = [
  "akcija",
  "nameštaj",
  "rasveta",
  "kućni aparati",
  "baštenski nameštaj",
  "bazeni",
] as const;

export const mobileSearchConfigInputSchema = z
  .object({
    currentItems: z
      .array(
        z.object({
          position: z.number().int().min(1).max(MOBILE_SEARCH_CURRENT_COUNT),
          label: z.string().trim().min(2).max(60),
          destination: z.string().trim().optional(),
          customHref: z.string().trim().max(1_000).optional(),
          existingImageUrl: z.string().trim().min(1).max(2_000).optional(),
        }),
      )
      .length(MOBILE_SEARCH_CURRENT_COUNT),
    productSkus: z
      .array(z.string().trim().min(1).max(100))
      .length(MOBILE_SEARCH_PRODUCT_COUNT),
    frequentQueries: z
      .array(z.string().trim().min(3).max(80))
      .length(MOBILE_SEARCH_QUERY_COUNT),
    viewAllDestination: z.string().trim().optional(),
    viewAllCustomHref: z.string().trim().max(1_000).optional(),
  })
  .superRefine((value, context) => {
    value.currentItems.forEach((item, index) => {
      if (!item.destination && !item.customHref) {
        context.addIssue({
          code: "custom",
          path: ["currentItems", index, "destination"],
          message: `Izaberite odredište za Aktuelno ${index + 1}.`,
        });
      }
    });
    if (!value.viewAllDestination && !value.viewAllCustomHref) {
      context.addIssue({
        code: "custom",
        path: ["viewAllDestination"],
        message: "Izaberite odredište dugmeta Pogledaj sve.",
      });
    }
    if (new Set(value.currentItems.map((item) => item.position)).size !== MOBILE_SEARCH_CURRENT_COUNT) {
      context.addIssue({ code: "custom", path: ["currentItems"], message: "Aktuelno mora imati pozicije 1 i 2." });
    }
    if (new Set(value.productSkus.map((sku) => sku.toLocaleLowerCase("sr-Latn-RS"))).size !== MOBILE_SEARCH_PRODUCT_COUNT) {
      context.addIssue({ code: "custom", path: ["productSkus"], message: "Izaberite četiri različita proizvoda." });
    }
    if (new Set(value.frequentQueries.map((query) => query.toLocaleLowerCase("sr-Latn-RS"))).size !== MOBILE_SEARCH_QUERY_COUNT) {
      context.addIssue({ code: "custom", path: ["frequentQueries"], message: "Unesite šest različitih čestih pretraga." });
    }
  });

export type MobileSearchConfigInput = z.infer<typeof mobileSearchConfigInputSchema>;

export const mobileSearchStoredConfigSchema = z.object({
  version: z.literal(1),
  currentItems: z
    .array(
      z.object({
        position: z.number().int().min(1).max(MOBILE_SEARCH_CURRENT_COUNT),
        label: z.string().trim().min(2).max(60),
        imageUrl: z.string().trim().min(1).max(2_000),
        destination: z.string().trim().optional().default(""),
        customHref: z.string().trim().max(1_000).optional().default(""),
      }),
    )
    .length(MOBILE_SEARCH_CURRENT_COUNT),
  productSkus: z
    .array(z.string().trim().min(1).max(100))
    .length(MOBILE_SEARCH_PRODUCT_COUNT),
  frequentQueries: z
    .array(z.string().trim().min(3).max(80))
    .length(MOBILE_SEARCH_QUERY_COUNT),
  viewAllDestination: z.string().trim().optional().default(""),
  viewAllCustomHref: z.string().trim().max(1_000).optional().default(""),
});

export type MobileSearchStoredConfig = z.infer<
  typeof mobileSearchStoredConfigSchema
>;

export function parseMobileSearchStoredConfig(value: unknown) {
  const parsed = mobileSearchStoredConfigSchema.safeParse(value);
  if (!parsed.success) return null;
  const configValidation = mobileSearchConfigInputSchema.safeParse({
    currentItems: parsed.data.currentItems,
    productSkus: parsed.data.productSkus,
    frequentQueries: parsed.data.frequentQueries,
    viewAllDestination: parsed.data.viewAllDestination,
    viewAllCustomHref: parsed.data.viewAllCustomHref,
  });
  return configValidation.success ? parsed.data : null;
}

export function assertMobileSearchInternalHref(value: string) {
  const href = normalizeMobileShortcutHref(value);
  if (!href.startsWith("/")) {
    throw new Error("Mobilna pretraga može da vodi samo na internu stranicu prodavnice.");
  }
  return href;
}

export function mobileSearchDestinationWindowIsLive(
  destination: { startsAt: Date; endsAt: Date },
  now = new Date(),
) {
  return destination.startsAt <= now && destination.endsAt >= now;
}

export function orderedAvailableProducts<T extends { slug: string }>(
  selectedSlugs: readonly string[],
  availableProducts: readonly T[],
) {
  const productsBySlug = new Map(availableProducts.map((product) => [product.slug, product]));
  return selectedSlugs.flatMap((slug) => {
    const product = productsBySlug.get(slug);
    return product ? [product] : [];
  });
}

export function fallbackCurrentItems<
  T extends { id?: string; slug: string; name: string; imageUrl?: string },
>(categories: readonly T[]) {
  return categories.slice(0, MOBILE_SEARCH_CURRENT_COUNT).map((category, index) => ({
    id: `fallback-category-${category.id ?? index}`,
    label: category.name,
    href: `/k/${category.slug}`,
    imageUrl: category.imageUrl ?? "",
  }));
}

export function parseMobileSearchConfigForm(formData: FormData) {
  return mobileSearchConfigInputSchema.safeParse({
    currentItems: Array.from({ length: MOBILE_SEARCH_CURRENT_COUNT }, (_, index) => ({
      position: index + 1,
      label: String(formData.get(`currentLabel${index + 1}`) ?? ""),
      destination: String(formData.get(`currentDestination${index + 1}`) ?? ""),
      customHref: String(formData.get(`currentCustomHref${index + 1}`) ?? ""),
      existingImageUrl: String(formData.get(`currentImageUrl${index + 1}`) ?? ""),
    })),
    productSkus: formData.getAll("productSkus").map(String),
    frequentQueries: Array.from({ length: MOBILE_SEARCH_QUERY_COUNT }, (_, index) =>
      String(formData.get(`frequentQuery${index + 1}`) ?? ""),
    ),
    viewAllDestination: String(formData.get("viewAllDestination") ?? ""),
    viewAllCustomHref: String(formData.get("viewAllCustomHref") ?? ""),
  });
}
