import type { Prisma } from "@prisma/client";
import { numericArticleSku } from "@/lib/article-sku";

function groupedNumericSku(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function exactNumericIdentifierWhere(
  search: string,
  searchColumn?: string,
): Prisma.ProductWhereInput | null {
  const numericSku = numericArticleSku(search);
  if (numericSku === null || numericSku < 10_000) return null;

  const skuVariants = Array.from(
    new Set([search, String(numericSku), groupedNumericSku(numericSku)]),
  );
  if (searchColumn === "sku") return { sku: { in: skuVariants } };
  if (searchColumn === "barcode") return { barcode: search };
  if (searchColumn) return null;

  // Numeric quick-search values are overwhelmingly article identifiers. Use
  // the existing SKU/barcode indexes rather than scanning every description,
  // relation and stock column with case-insensitive contains predicates.
  return {
    OR: [{ sku: { in: skuVariants } }, { barcode: search }],
  };
}

export function articleSearchWhere(
  query?: string,
  searchColumn?: string,
): Prisma.ProductWhereInput | undefined {
  const search = query?.trim();
  if (!search) return undefined;
  const exactIdentifier = exactNumericIdentifierWhere(search, searchColumn);
  if (exactIdentifier) return exactIdentifier;
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
