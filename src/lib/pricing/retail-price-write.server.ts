import "server-only";

import { Prisma } from "@prisma/client";

export function activeRetailPriceEntryWhere(now = new Date()) {
  return {
    price: { gt: 0 },
    validFrom: { lte: now },
    OR: [{ validTo: null }, { validTo: { gte: now } }],
    priceList: {
      is: {
        kind: "RETAIL" as const,
        active: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
    },
  } satisfies Prisma.PriceListEntryWhereInput;
}

export async function upsertActiveRetailPrice(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    price: number | Prisma.Decimal;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const price = new Prisma.Decimal(input.price);
  if (price.lte(0)) {
    throw new Error("MP cena iz dobavljačkog izvora mora biti veća od nule.");
  }
  const priceLists = await tx.priceList.findMany({
    where: {
      kind: "RETAIL",
      active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      ],
    },
    orderBy: [{ code: "asc" }, { validFrom: "desc" }],
    select: { id: true, code: true, currency: true },
  });
  const priceList =
    priceLists.find((candidate) => candidate.code.toUpperCase() === "MP") ??
    priceLists[0];
  if (!priceList) {
    throw new Error("Nema aktivnog RETAIL cenovnika za dobavljačku MP cenu.");
  }
  if (priceList.currency !== "RSD") {
    throw new Error(`RETAIL cenovnik ${priceList.code} nije u RSD.`);
  }
  const current = await tx.priceListEntry.findFirst({
    where: {
      priceListId: priceList.id,
      productId: input.productId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    orderBy: { validFrom: "desc" },
    select: { id: true },
  });
  if (current) {
    return tx.priceListEntry.update({
      where: { id: current.id },
      data: { price },
    });
  }
  return tx.priceListEntry.create({
    data: {
      priceListId: priceList.id,
      productId: input.productId,
      price,
      validFrom: now,
    },
  });
}

export async function removeActiveRetailPrice(
  tx: Prisma.TransactionClient,
  input: { productId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return tx.priceListEntry.deleteMany({
    where: {
      productId: input.productId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
      priceList: {
        is: {
          kind: "RETAIL",
          active: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          ],
        },
      },
    },
  });
}
