import "server-only";

import type { Prisma } from "@prisma/client";

type CategoryGroupClient = Pick<Prisma.TransactionClient, "group">;

export async function ensureCategoryGroup(
  tx: CategoryGroupClient,
  category: { name: string; slug: string },
  previous?: { name: string; slug: string } | null,
) {
  const existing = await tx.group.findFirst({
    where: {
      OR: [
        { slug: category.slug },
        { name: { equals: category.name, mode: "insensitive" } },
        ...(previous
          ? [
              { slug: previous.slug },
              { name: { equals: previous.name, mode: "insensitive" as const } },
            ]
          : []),
      ],
    },
  });
  if (existing) {
    if (existing.name === category.name && existing.slug === category.slug) {
      return existing;
    }
    return tx.group.update({
      where: { id: existing.id },
      data: { name: category.name, slug: category.slug },
    });
  }

  return tx.group.upsert({
    where: { slug: category.slug },
    create: {
      slug: category.slug,
      name: category.name,
    },
    update: {},
  });
}
