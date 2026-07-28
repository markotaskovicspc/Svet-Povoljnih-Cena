import type { Prisma } from "@prisma/client";

export function articleSearchWhere(
  query?: string,
  searchColumn?: string,
): Prisma.ProductWhereInput | undefined {
  const search = query?.trim();
  if (!search) return undefined;
  if (searchColumn === "sku") {
    return { sku: { contains: search, mode: "insensitive" } };
  }
  if (searchColumn === "shortName") {
    return {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { shortName: { contains: search, mode: "insensitive" } },
      ],
    };
  }
  if (searchColumn === "barcode") {
    return { barcode: { contains: search, mode: "insensitive" } };
  }
  if (searchColumn === "shortDescription") {
    return { shortDescription: { contains: search, mode: "insensitive" } };
  }
  const numericSearch = Number(search.replace(",", "."));
  return {
    OR: [
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { shortName: { contains: search, mode: "insensitive" } },
      { shortDescription: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { group: { name: { contains: search, mode: "insensitive" } } },
      { collection: { name: { contains: search, mode: "insensitive" } } },
      {
        categories: {
          some: { category: { name: { contains: search, mode: "insensitive" } } },
        },
      },
      ...(Number.isFinite(numericSearch) && Number.isInteger(numericSearch)
        ? [{ stock: numericSearch }, { incomingStock: numericSearch }]
        : []),
    ],
  };
}
