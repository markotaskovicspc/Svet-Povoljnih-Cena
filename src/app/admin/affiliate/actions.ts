"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { normalizeAffiliateCode } from "@/lib/affiliate/shared";
const meta = { allowed: ["ADS", "OPS"] as const, module: "/admin/affiliate", entity: "AffiliatePartner" };
export async function createAffiliate(_state: AdminActionState, form: FormData) {
  return withAdminState({ ...meta, module: "/admin/affiliate", action: "affiliate.create" }, async () => {
    const name = String(form.get("name") ?? "").trim();
    const code = normalizeAffiliateCode(form.get("code"));
    if (!name || name.length > 100 || !code) return { ok: false, error: "Unesite ime (do 100 znakova) i kod (3–40 malih slova, brojeva ili crtica)." };
    try {
      const partner = await db.affiliatePartner.create({ data: { name, code } });
      revalidatePath("/admin/affiliate");
      return { ok: true, entityId: partner.id, diff: { name, code }, message: "Partner je napravljen. Promo link je spreman." };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "Ovaj kod već postoji. Izaberite drugi." };
      throw error;
    }
  })();
}
export async function toggleAffiliate(_state: AdminActionState, form: FormData) {
  return withAdminState({ ...meta, module: "/admin/affiliate", action: "affiliate.access" }, async () => {
    const id = String(form.get("id") ?? "");
    const enabled = form.get("enabled") === "true";
    const result = await db.affiliatePartner.updateMany({ where: { id }, data: { enabled } });
    if (!result.count) return { ok: false, error: "Partner nije pronađen." };
    revalidatePath("/admin/affiliate");
    return { ok: true, entityId: id, diff: { enabled }, message: enabled ? "Praćenje je uključeno." : "Praćenje novih prodaja je isključeno. Istorija je sačuvana." };
  })();
}
