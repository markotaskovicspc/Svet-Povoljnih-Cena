"use server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { isWarehouseOnlyPolicy, parseAccessPolicy } from "@/lib/admin/access-policy";

const accountSchema = z.object({
  firstName: z.string().trim().min(1, "Unesite ime.").max(80),
  lastName: z.string().trim().max(80),
  email: z.email("Unesite ispravnu e-poštu.").max(254).transform(value => value.toLowerCase()),
  password: z.string().min(8, "Lozinka mora imati najmanje 8 znakova.").max(72)
    .refine(value => value === value.trim(), "Lozinka ne sme počinjati niti završavati razmakom.")
    .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Lozinka može imati najviše 72 UTF-8 bajta."),
});
const targetSchema = z.object({ id: z.string().min(1, "Nalog nije izabran.").max(200) });
const enabledSchema = targetSchema.extend({ enabled: z.enum(["true", "false"]) });

function accountInput(form: FormData) {
  return accountSchema.safeParse({
    firstName: form.get("firstName"), lastName: form.get("lastName") ?? "",
    email: typeof form.get("email") === "string" ? String(form.get("email")).trim() : form.get("email"),
    password: form.get("password"),
  });
}

function selectedPolicy(form: FormData) {
  const policy = parseAccessPolicy({ version: 1, modules: form.getAll("modules") });
  return policy?.modules.length ? policy : null;
}

function accountWriteError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    ? "Nalog sa tom e-poštom već postoji."
    : "Nalog nije sačuvan. Pokušajte ponovo.";
}

export async function createOperator(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["OPS"], module: "/admin/erp/operativci", action: "warehouse.account.create", entity: "AdminUser" }, async () => {
    const input = accountInput(formData);
    if (!input.success) return { ok: false as const, error: input.error.issues[0].message };
    const { password, ...data } = input.data;
    let account;
    try {
      account = await db.adminUser.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 12), role: "WAREHOUSE" }, select: { id: true } });
    } catch (error) {
      // Do not pass a DB/credential exception through the audit wrapper: it
      // can contain the password hash or submitted credential fields.
      return { ok: false as const, error: accountWriteError(error) };
    }
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: account.id, diff: { ...data, role: "WAREHOUSE" }, message: "Nalog je napravljen. Prosledite magacioneru link za prijavu, e-poštu i lozinku." };
  })();
}
export async function setOperatorEnabled(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["OPS"], module: "/admin/erp/operativci", action: "warehouse.account.access", entity: "AdminUser" }, async () => {
    const input = enabledSchema.safeParse({ id: formData.get("id"), enabled: formData.get("enabled") });
    if (!input.success) return { ok: false as const, error: "Izaberite nalog i ispravan status pristupa." };
    const { id } = input.data;
    const enabled = input.data.enabled === "true";
    const result = await db.adminUser.updateMany({ where: { id, role: "WAREHOUSE" }, data: { enabled } });
    if (result.count !== 1) return { ok: false as const, error: "Nalog magacionera nije pronađen." };
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: id, diff: { enabled }, message: enabled ? "Pristup je uključen." : "Pristup je isključen. Nalog više ne može da pristupi magacinu." };
  })();
}

export async function createStaffAccount(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["SUPER"], module: "/admin/erp/operativci", action: "staff.account.create", entity: "AdminUser" }, async () => {
    const input = accountInput(formData);
    if (!input.success) return { ok: false as const, error: input.error.issues[0].message };
    const accessPolicy = selectedPolicy(formData);
    if (!accessPolicy) return { ok: false as const, error: "Izaberite bar jedan dozvoljeni modul." };
    const role = isWarehouseOnlyPolicy(accessPolicy) ? "WAREHOUSE" : "CUSTOM";
    const { password, ...data } = input.data;
    let account;
    try {
      account = await db.adminUser.create({
        data: { ...data, passwordHash: await bcrypt.hash(password, 12), role, accessPolicy },
        select: { id: true },
      });
    } catch (error) {
      return { ok: false as const, error: accountWriteError(error) };
    }
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: account.id, diff: { ...data, role, accessPolicy },
      message: "Korisnički nalog je napravljen. Prosledite zaposlenom link za prijavu, e-poštu i lozinku." };
  })();
}

export async function updateStaffAccountAccess(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["SUPER"], module: "/admin/erp/operativci", action: "staff.account.permissions", entity: "AdminUser" }, async actorId => {
    const target = targetSchema.safeParse({ id: formData.get("id") });
    if (!target.success || target.data.id === actorId) return { ok: false as const, error: "Izaberite drugi korisnički nalog." };
    const accessPolicy = selectedPolicy(formData);
    if (!accessPolicy) return { ok: false as const, error: "Izaberite bar jedan dozvoljeni modul." };
    const role = isWarehouseOnlyPolicy(accessPolicy) ? "WAREHOUSE" : "CUSTOM";
    const result = await db.adminUser.updateMany({
      where: { id: target.data.id, NOT: { id: actorId }, role: { not: "SUPER" } },
      data: { role, accessPolicy },
    });
    if (result.count !== 1) return { ok: false as const, error: "Korisnički nalog nije pronađen ili ne može da se menja ovim putem." };
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: target.data.id, diff: { role, accessPolicy }, message: "Pristup modulima je sačuvan." };
  })();
}

export async function setStaffAccountEnabled(_state: AdminActionState, formData: FormData) {
  return withAdminState({ allowed: ["SUPER"], module: "/admin/erp/operativci", action: "staff.account.access", entity: "AdminUser" }, async actorId => {
    const input = enabledSchema.safeParse({ id: formData.get("id"), enabled: formData.get("enabled") });
    if (!input.success || input.data.id === actorId) return { ok: false as const, error: "Izaberite drugi nalog i ispravan status pristupa." };
    const { id } = input.data;
    const enabled = input.data.enabled === "true";
    const result = await db.adminUser.updateMany({
      where: { id, NOT: { id: actorId }, role: { not: "SUPER" } }, data: { enabled },
    });
    if (result.count !== 1) return { ok: false as const, error: "Korisnički nalog nije pronađen ili ne može da se menja ovim putem." };
    revalidatePath("/admin/erp/operativci");
    return { ok: true as const, entityId: id, diff: { enabled }, message: enabled ? "Pristup je uključen." : "Pristup je isključen." };
  })();
}
