"use server";

import { revalidatePath, updateTag } from "next/cache";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { db } from "@/lib/db";
import { getStandardPromoSkus } from "@/lib/landing-pages/standard-promo.server";
import { promoProductOrderKey, promoProductOrderSchema, standardPromoPage } from "@/lib/storefront/promo-product-order";

export async function saveStandardPromoOrder(_state: AdminActionState, formData: FormData) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "landing.standardPromoOrder", entity: "AdminSetting" },
    async (actorId, data: FormData) => {
      const page = standardPromoPage(String(data.get("pageKey")));
      if (!page) return { ok: false as const, error: "Nepostojeća promo strana." };
      let input: unknown;
      try { input = JSON.parse(String(data.get("productSkus"))); } catch { return { ok: false as const, error: "Neispravan redosled proizvoda." }; }
      const parsed = promoProductOrderSchema.safeParse(input);
      if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Neispravan redosled." };
      if (parsed.data.length) {
        const eligible = new Set(await getStandardPromoSkus(page.key, true));
        if (parsed.data.some(sku => !eligible.has(sku))) return { ok: false as const, error: "Ponuda je promenjena. Osvežite stranicu da učitate aktuelne proizvode." };
      }
      const key = promoProductOrderKey(page.key);
      await db.adminSetting.upsert({ where: { key }, create: { key, value: parsed.data, updatedBy: actorId }, update: { value: parsed.data, updatedBy: actorId } });
      updateTag("storefront-home");
      updateTag("catalog-products");
      revalidatePath("/");
      revalidatePath(page.href);
      revalidatePath("/admin/erp/landing-strane");
      revalidatePath(`/admin/erp/landing-strane/standard-${page.key}`);
      return { ok: true as const, entityId: key, diff: { pageKey: page.key, productSkus: parsed.data }, message: parsed.data.length ? "Redosled je sačuvan na promo stranici i početnoj." : "Vraćen je automatski redosled kataloga." };
    },
  )(formData);
}
