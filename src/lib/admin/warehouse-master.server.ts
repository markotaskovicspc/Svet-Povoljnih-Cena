import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeWarehouseDetails } from "@/lib/admin/warehouse-master";

const MAX_CREATE_ATTEMPTS = 4;

function nextWarehouseCode(codes: string[]) {
  const highestSerial = codes.reduce((highest, code) => {
    const match = /^MAG-(\d+)$/i.exec(code);
    if (!match) return highest;
    return Math.max(highest, Number.parseInt(match[1], 10));
  }, 0);
  return `MAG-${String(highestSerial + 1).padStart(3, "0")}`;
}

function isRetryableCreateError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export async function createWarehouseWithAutomaticCode(
  input: Record<string, unknown>,
) {
  const details = normalizeWarehouseDetails(input);

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const [warehouses, activeDefaultCount] = await Promise.all([
            tx.warehouse.findMany({ select: { code: true } }),
            tx.warehouse.count({ where: { active: true, isDefault: true } }),
          ]);
          const becomesDefault = activeDefaultCount === 0;
          if (becomesDefault) {
            await tx.warehouse.updateMany({
              where: { isDefault: true },
              data: { isDefault: false },
            });
          }
          return tx.warehouse.create({
            data: {
              code: nextWarehouseCode(warehouses.map((warehouse) => warehouse.code)),
              ...details,
              active: true,
              isDefault: becomesDefault,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (attempt < MAX_CREATE_ATTEMPTS && isRetryableCreateError(error)) continue;
      throw error;
    }
  }

  throw new Error("Magacin nije kreiran. Pokušajte ponovo.");
}
