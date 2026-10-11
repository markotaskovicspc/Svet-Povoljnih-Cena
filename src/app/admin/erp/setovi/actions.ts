"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { withAdminState } from "@/lib/admin";
import { db } from "@/lib/db";
import { allocateSetPrice, productSetInputSchema } from "@/lib/product-sets/core";

export const saveProductSet = withAdminState<[unknown], { id: string }>({ allowed: ["CONTENT", "OPS"], action: "product-set.save", entity: "ProductSet" }, async (_actor, raw) => {
  const input = productSetInputSchema.safeParse(raw);
  if (!input.success) return { ok: false, message: input.error.issues.map(i => i.message).join(" ") };
  const data = input.data;
  const products = await db.product.findMany({ where: { sku: { in: data.components.map(c => c.sku) }, deletedAt: null }, select: { id: true, sku: true, fullPrice: true } });
  const bySku = new Map(products.map(p => [p.sku, p]));
  const missing = data.components.filter(c => !bySku.has(c.sku)).map(c => c.sku);
  if (missing.length) return { ok: false, message: `Artikli nisu pronađeni: ${missing.join(", ")}.` };
  const allocations = allocateSetPrice(data.price, data.components.map(c => ({ quantity: c.quantity, weight: Number(bySku.get(c.sku)!.fullPrice) })));
  const saved = await db.$transaction(async tx => {
    if (data.id) {
      const rows = await tx.$queryRaw<Array<{ updatedAt: Date }>>`SELECT "updatedAt" FROM "ProductSet" WHERE "id" = ${data.id} FOR UPDATE`;
      if (!rows.length || rows[0].updatedAt.toISOString() !== data.version) throw new Error("Set je promenjen u drugom prozoru. Osvežite stranicu pre izmene.");
    }
    const fields = { name: data.name, slug: data.slug, description: data.description, active: data.active };
    const set = data.id ? await tx.productSet.update({ where: { id: data.id }, data: fields }) : await tx.productSet.create({ data: fields });
    await tx.productSetComponent.deleteMany({ where: { setId: set.id } });
    await tx.productSetComponent.createMany({ data: data.components.map((c, i) => ({ setId: set.id, productId: bySku.get(c.sku)!.id, quantity: c.quantity, unitPrice: new Prisma.Decimal(allocations[i]), position: i })) });
    return set;
  });
  revalidatePath("/admin/erp/setovi"); revalidatePath("/setovi", "layout");
  return { ok: true, entityId: saved.id, diff: { ...data, allocations }, message: data.active ? "Set je sačuvan i objavljen. Kupovina je moguća kada su sve komponente objavljene i imaju zalihu." : "Nacrt seta je sačuvan.", result: { id: saved.id } };
});
