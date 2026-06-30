import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Address book CRUD for `/nalog/adrese`.
 * Default-address invariant: at most one default per user — flipped via a
 * single transaction that resets siblings.
 */

export const addressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(32),
  street: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().regex(/^\d{5}$/),
  xExpressTownId: z.coerce.number().int().positive().optional().nullable(),
  xExpressStreetId: z.coerce.number().int().positive().optional().nullable(),
  country: z.string().trim().length(2).default("RS"),
  companyName: z.string().trim().max(120).optional(),
  pib: z.string().trim().regex(/^\d{9}$/).optional(),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.infer<typeof addressSchema>;

export async function listAddresses(userId: string) {
  return db.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function getAddress(userId: string, id: string) {
  return db.address.findFirst({ where: { id, userId } });
}

export async function createAddress(userId: string, input: AddressInput) {
  const data = addressSchema.parse(input);
  return db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    } else {
      const count = await tx.address.count({ where: { userId } });
      if (count === 0) data.isDefault = true; // first address → default
    }
    return tx.address.create({ data: { ...data, userId } });
  });
}

export async function updateAddress(userId: string, id: string, input: AddressInput) {
  const data = addressSchema.parse(input);
  return db.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new Error("ADDRESS_NOT_FOUND");
    if (data.isDefault) {
      await tx.address.updateMany({
        where: { userId, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.address.update({ where: { id }, data });
  });
}

export async function deleteAddress(userId: string, id: string) {
  const res = await db.address.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
