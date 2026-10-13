"use server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState, type AdminActionState } from "@/lib/admin";

const accountSchema = z.object({
  firstName: z.string().trim().min(1, "Unesite ime.").max(80),
  lastName: z.string().trim().max(80),
  email: z.email("Unesite ispravnu e-poštu.").max(254).transform(value => value.toLowerCase()),
  password: z.string().min(8, "Lozinka mora imati najmanje 8 znakova.").max(72),
});
export async function createOperator(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "warehouse.account.create", entity: "AdminUser" }, async () => {
    const input = accountSchema.safeParse({
      firstName: formData.get("firstName"), lastName: formData.get("lastName") ?? "",
      email: String(formData.get("email") ?? "").trim(), password: String(formData.get("password") ?? "").trim(),
    });
    if (!input.success) return { ok: false as const, error: input.error.issues[0].message };
    const { password, ...data } = input.data;
    let account;
    try {
      account = await db.adminUser.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 12), role: "WAREHOUSE" }, select: { id: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false as const, error: "Nalog sa tom e-poštom već postoji." };
      throw error;
    }
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: account.id, diff: { ...data, role: "WAREHOUSE" }, message: "Nalog je napravljen. Prosledite magacioneru link za prijavu, e-poštu i lozinku." };
  })();
}
export async function setOperatorEnabled(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "warehouse.account.access", entity: "AdminUser" }, async () => {
    const id = String(formData.get("id") ?? "");
    const enabled = formData.get("enabled") === "true";
    const result = await db.adminUser.updateMany({ where: { id, role: "WAREHOUSE" }, data: { enabled } });
    if (result.count !== 1) return { ok: false as const, error: "Nalog magacionera nije pronađen." };
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: id, diff: { enabled }, message: enabled ? "Pristup je uključen." : "Pristup je isključen. Nalog više ne može da pristupi magacinu." };
  })();
}
