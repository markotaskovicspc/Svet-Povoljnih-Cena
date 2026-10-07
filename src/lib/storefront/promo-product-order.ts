import { z } from "zod";
import type { ListProductsInput } from "@/lib/api/catalog";

export const STANDARD_PROMO_PAGES: Array<{ key: string; title: string; href: string; query: ListProductsInput }> = [
  { key: "heroji-meseca", title: "Heroji meseca", href: "/heroji-meseca", query: { heroOnly: true } },
  { key: "akcija", title: "Mesečna akcija", href: "/akcija", query: { onSaleOnly: true } },
  { key: "nedeljna-akcija", title: "Nedeljna akcija", href: "/nedeljna-akcija", query: { actionSlug: "nedeljna-akcija" } },
  { key: "niske-cene-pod-zastitom", title: "Niske cene pod trajnom zaštitom", href: "/niske-cene-pod-zastitom", query: { permanentOnly: true } },
  { key: "ogranicena-ponuda", title: "Dok traju zalihe", href: "/ogranicena-ponuda", query: { limitedOnly: true } },
  { key: "sve-do-999", title: "Sve do 999", href: "/sve-do-999", query: { maxPrice: 999 } },
  { key: "novo", title: "Novo u ponudi", href: "/novo", query: { newOnly: true } },
  { key: "outlet", title: "Outlet", href: "/outlet", query: { outletOnly: true } },
  { key: "specijalne-ponude", title: "Trajno niske cene", href: "/specijalne-ponude", query: { actionSlug: "specijalne-ponude" } },
];

export const promoProductOrderSchema = z.array(z.string().trim().min(1).max(120)).max(3000)
  .refine(skus => new Set(skus).size === skus.length, "Šifre se ne smeju ponavljati.");

export function promoProductOrderKey(key: string) { return `storefront.promo.product-order.${key}`; }
export function standardPromoPage(key: string) { return STANDARD_PROMO_PAGES.find(page => page.key === key); }
export function promoKeyForQuery(input: ListProductsInput): string | undefined {
  if (input.promoOrderKey) return standardPromoPage(input.promoOrderKey)?.key;
  if (input.actionSlug) return standardPromoPage(input.actionSlug)?.key;
  if (input.heroOnly) return "heroji-meseca";
  if (input.permanentOnly) return "niske-cene-pod-zastitom";
  if (input.onSaleOnly) return "akcija";
  if (input.limitedOnly) return "ogranicena-ponuda";
  if (input.outletOnly) return "outlet";
  if (input.newOnly) return "novo";
  if (input.maxPrice === 999) return "sve-do-999";
}

export function readPromoProductOrder(value: unknown): string[] {
  const result = promoProductOrderSchema.safeParse(value);
  return result.success ? result.data : [];
}

export function comparePromoRank(a: string, b: string, ranks: Map<string, number>) {
  return (ranks.get(a) ?? ranks.size) - (ranks.get(b) ?? ranks.size);
}
