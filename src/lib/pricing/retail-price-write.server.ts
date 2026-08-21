import "server-only";

import { Prisma } from "@prisma/client";

const BEFORE_NEXT_PRICE_MS = 1;

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
    throw new Error("MP cena mora biti veća od nule.");
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
    throw new Error("Nema aktivnog RETAIL cenovnika za MP cenu.");
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
    select: { id: true, price: true, validFrom: true },
  });
  if (current) {
    if (current.price.equals(price)) {
      await normalizeRetailPriceTimeline(tx, {
        priceListId: priceList.id,
        productId: input.productId,
      });
      return current;
    }
    if (current.validFrom.getTime() >= now.getTime()) {
      const updated = await tx.priceListEntry.update({
        where: { id: current.id },
        data: { price },
      });
      await normalizeRetailPriceTimeline(tx, {
        priceListId: priceList.id,
        productId: input.productId,
      });
      return updated;
    }
  }
  return upsertRetailPriceInterval(tx, {
    priceListId: priceList.id,
    productId: input.productId,
    price,
    validFrom: now,
    validTo: null,
  });
}

/**
 * Writes one dated price and then canonicalizes the whole product/list
 * timeline. A later entry always closes the previous one one millisecond
 * before its start, so two MP prices can never both be current.
 */
export async function upsertRetailPriceInterval(
  tx: Prisma.TransactionClient,
  input: {
    priceListId: string;
    productId: string;
    price: number | Prisma.Decimal;
    validFrom: Date;
    validTo?: Date | null;
  },
) {
  const price = new Prisma.Decimal(input.price);
  if (price.lte(0)) {
    throw new Error("MP cena mora biti veća od nule.");
  }
  if (
    input.validTo &&
    input.validTo.getTime() < input.validFrom.getTime()
  ) {
    throw new Error("Datum važenja od ne može biti posle datuma do.");
  }

  const saved = await tx.priceListEntry.upsert({
    where: {
      priceListId_productId_validFrom: {
        priceListId: input.priceListId,
        productId: input.productId,
        validFrom: input.validFrom,
      },
    },
    create: {
      priceListId: input.priceListId,
      productId: input.productId,
      price,
      validFrom: input.validFrom,
      validTo: input.validTo ?? null,
    },
    update: {
      price,
      validTo: input.validTo ?? null,
    },
  });

  await normalizeRetailPriceTimeline(tx, {
    priceListId: input.priceListId,
    productId: input.productId,
  });
  return saved;
}

export async function normalizeRetailPriceTimeline(
  tx: Prisma.TransactionClient,
  input: { priceListId: string; productId: string },
) {
  const entries = await tx.priceListEntry.findMany({
    where: input,
    orderBy: { validFrom: "asc" },
    select: { id: true, validFrom: true, validTo: true },
  });

  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index]!;
    const next = entries[index + 1]!;
    if (entry.validTo && entry.validTo.getTime() < next.validFrom.getTime()) {
      continue;
    }
    await tx.priceListEntry.update({
      where: { id: entry.id },
      data: {
        validTo: new Date(next.validFrom.getTime() - BEFORE_NEXT_PRICE_MS),
      },
    });
  }
}

export async function removeActiveRetailPrice(
  tx: Prisma.TransactionClient,
  input: { productId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return tx.priceListEntry.updateMany({
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
    data: { validTo: new Date(now.getTime() - 1) },
  });
}
