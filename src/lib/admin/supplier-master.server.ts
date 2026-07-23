import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatSupplierCode } from "@/lib/supplier-master";

type SupplierDataFactory = (
  code: string,
) => Prisma.SupplierUncheckedCreateInput;

/**
 * Uses the unique Supplier.code constraint as the concurrency arbiter. This
 * deliberately avoids an interactive transaction because production keeps the
 * process-local pool at one connection.
 */
export async function createSupplierWithAutomaticCode(
  dataOrFactory: Prisma.SupplierUncheckedCreateInput | SupplierDataFactory,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [sequence] = await db.$queryRaw<Array<{ lastValue: number | null }>>`
      SELECT MAX(SUBSTRING("code" FROM '^DOB-([0-9]+)$')::INTEGER) AS "lastValue"
      FROM "Supplier"
      WHERE "code" ~ '^DOB-[0-9]+$'
    `;
    const code = formatSupplierCode(Number(sequence?.lastValue ?? 0) + 1);
    const data =
      typeof dataOrFactory === "function"
        ? dataOrFactory(code)
        : dataOrFactory;

    try {
      return await db.supplier.create({
        data: {
          ...data,
          code,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }

      const duplicateName = await db.supplier.findUnique({
        where: { name: data.name },
        select: { id: true },
      });
      const duplicateIntegration =
        !duplicateName && typeof data.integrationKey === "string"
          ? await db.supplier.findUnique({
              where: { integrationKey: data.integrationKey },
              select: { id: true },
            })
          : null;
      if (duplicateName || duplicateIntegration || attempt === 11) {
        throw error;
      }
    }
  }

  throw new Error("Automatska šifra dobavljača nije mogla biti dodeljena.");
}
