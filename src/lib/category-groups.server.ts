import "server-only";

import type { Prisma } from "@prisma/client";

type CategoryGroupClient = Pick<Prisma.TransactionClient, "group">;

export async function ensureCategoryGroup(
  tx: CategoryGroupClient,
  category: { name: string; slug: string },
) {
  const existing = await tx.group.findFirst({
    where: {
      OR: [
        { slug: category.slug },
        { name: { equals: category.name, mode: "insensitive" } },
      ],
    },
  });
  if (existing) return existing;

  return tx.group.upsert({
    where: { slug: category.slug },
    create: {
      slug: category.slug,
      name: category.name,
    },
    update: {},
  });
}
