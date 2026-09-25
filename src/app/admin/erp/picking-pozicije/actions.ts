"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";

const schema = z.object({ warehouseId: z.string().min(1), number: z.coerce.number().int().min(1).max(240), routeOrder: z.coerce.number().int().min(1).max(10000), note: z.string().max(1000), version: z.string() });
export async function savePosition(_state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "picking.position.save", entity: "WarehousePickingPosition" }, async () => {
    const input = schema.parse(Object.fromEntries(form));
    const skus = [...new Set(String(form.get("skus") ?? "").split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];
    const supplierIds = [...new Set(form.getAll("supplierIds").map(String))];
    if (skus.length > 300 || supplierIds.length > 100) throw new Error("Previše dodela za jednu poziciju.");
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Warehouse" WHERE id = ${input.warehouseId} FOR UPDATE`;
      const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
      if (!warehouse?.active) throw new Error("Izaberite aktivan magacin.");
      const current = await tx.warehousePickingPosition.findUnique({ where: { warehouseId_number: { warehouseId: input.warehouseId, number: input.number } } });
      if ((current?.updatedAt.toISOString() ?? "") !== input.version) throw new Error("Drugi korisnik je izmenio poziciju. Osvežite stranicu pa ponovite unos.");
      const products = await tx.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } });
      const missing = skus.filter(sku => !products.some(p => p.sku === sku));
      if (missing.length) throw new Error(`Nepostojeće šifre: ${missing.join(", ")}`);
      if (await tx.supplier.count({ where: { id: { in: supplierIds } } }) !== supplierIds.length) throw new Error("Dobavljač nije pronađen.");
      const { version: _version, ...values } = input;
      void _version;
      await tx.warehousePickingPosition.upsert({ where: { warehouseId_number: { warehouseId: input.warehouseId, number: input.number } }, create: { ...values, skus, supplierIds }, update: { routeOrder: input.routeOrder, note: input.note, skus, supplierIds } });
    });
    revalidatePath("/admin/erp/picking-pozicije");
    return { ok: true, message: "Pozicija je sačuvana.", diff: { ...input, skus, supplierIds } };
  })();
}
