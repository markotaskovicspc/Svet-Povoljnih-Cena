import "server-only";

import { Prisma } from "@prisma/client";
import {
  articleSlug,
  composeArticleName,
  normalizeArticleText,
  splitArticleValues,
} from "@/lib/article-master";

export async function nextArticleSku(tx: Prisma.TransactionClient, date = new Date()) {
  const year = date.getFullYear();
  for (let attempt = 0; attempt < 20; attempt++) {
    const sequence = await tx.articleSequence.upsert({
      where: { year },
      create: { year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
      select: { lastValue: true },
    });
    const sku = `NOV-${year}-${String(sequence.lastValue).padStart(5, "0")}`;
    const exists = await tx.product.findUnique({
      where: { sku },
      select: { id: true },
    });
    if (!exists) return sku;
  }
  throw new Error("Automatska šifra artikla nije mogla da se rezerviše.");
}

export async function resolveNamedArticleRelation(
  tx: Prisma.TransactionClient,
  kind: "group" | "collection",
  input: { id?: string | null; name?: string | null },
) {
  const name = normalizeArticleText(input.name);
  if (input.id && !name) {
    const row =
      kind === "group"
        ? await tx.group.findUnique({ where: { id: input.id } })
        : await tx.collection.findUnique({ where: { id: input.id } });
    if (!row) throw new Error("Izabrana vrednost šifarnika ne postoji.");
    return row;
  }
  if (!name) return null;
  const slug = articleSlug(name);
  if (!slug) throw new Error("Naziv šifarnika nije ispravan.");
  return kind === "group"
    ? tx.group.upsert({
        where: { slug },
        create: { slug, name },
        update: { name },
      })
    : tx.collection.upsert({
        where: { slug },
        create: { slug, name },
        update: { name },
      });
}

export async function resolveArticleCategory(
  tx: Prisma.TransactionClient,
  input: {
    id?: string | null;
    name?: string | null;
    parentId?: string | null;
  },
) {
  const name = normalizeArticleText(input.name);
  if (input.id && !name) {
    const category = await tx.category.findUnique({ where: { id: input.id } });
    if (!category) throw new Error("Izabrana kategorija ne postoji.");
    return category;
  }
  if (!name) return null;
  const parent = input.parentId
    ? await tx.category.findUnique({ where: { id: input.parentId } })
    : null;
  if (input.parentId && !parent) throw new Error("Nadređena kategorija ne postoji.");
  const slug = articleSlug(name);
  const path = `${parent?.path ?? ""}/${slug}`.replace(/\/+/g, "/");
  return tx.category.upsert({
    where: { path },
    create: {
      name,
      slug: parent ? `${articleSlug(parent.name)}-${slug}` : slug,
      path,
      level: parent ? parent.level + 1 : 0,
      parentId: parent?.id ?? null,
    },
    update: { name },
  });
}

export async function syncArticleLookupAssignments(
  tx: Prisma.TransactionClient,
  productId: string,
  input: {
    attributes: Array<string | null | undefined>;
    colors: Array<string | null | undefined>;
    benefits: string | string[];
    certificates: string | string[];
  },
) {
  const byKind = {
    ATTRIBUTE: splitArticleValues(input.attributes.filter(Boolean) as string[]),
    COLOR: splitArticleValues(input.colors.filter(Boolean) as string[]),
    BENEFIT: splitArticleValues(input.benefits),
    CERTIFICATE: splitArticleValues(input.certificates),
  } as const;
  const kinds = Object.keys(byKind) as Array<keyof typeof byKind>;
  const desired = kinds.flatMap((kind) =>
    byKind[kind].map((value) => ({
      kind,
      value,
      slug: articleSlug(value),
    })),
  );
  const desiredWhere = desired.map(({ kind, value }) => ({ kind, value }));

  const currentAssignments = await tx.productLookupAssignment.findMany({
    where: { productId, lookupValue: { kind: { in: kinds } } },
    select: {
      lookupValue: {
        select: { kind: true, value: true, slug: true, active: true },
      },
    },
  });
  const desiredSignature = desired
    .map(({ kind, value, slug }) => `${kind}\u0000${value}\u0000${slug}`)
    .sort();
  const currentSignature = currentAssignments
    .filter(({ lookupValue }) => lookupValue.active)
    .map(
      ({ lookupValue }) =>
        `${lookupValue.kind}\u0000${lookupValue.value}\u0000${lookupValue.slug}`,
    )
    .sort();
  if (
    currentAssignments.length === currentSignature.length &&
    currentSignature.length === desiredSignature.length &&
    currentSignature.every((value, index) => value === desiredSignature[index])
  ) {
    return byKind;
  }

  if (desired.length) {
    // Keep the transaction bounded: a full article can have dozens of lookup
    // values, so serial upserts make the save time grow linearly. createMany is
    // also safe when two admins introduce the same dictionary value at once.
    await tx.productLookupValue.createMany({
      data: desired.map(({ kind, value, slug }) => ({
        kind,
        value,
        slug,
        active: true,
      })),
      skipDuplicates: true,
    });
    await tx.productLookupValue.updateMany({
      where: { OR: desiredWhere },
      data: { active: true },
    });
  }

  let lookups = desired.length
    ? await tx.productLookupValue.findMany({
        where: { OR: desiredWhere },
        select: { id: true, kind: true, value: true, slug: true },
      })
    : [];
  const found = new Map(
    lookups.map((lookup) => [`${lookup.kind}\u0000${lookup.value}`, lookup]),
  );
  const missing = desired.filter(
    ({ kind, value }) => !found.has(`${kind}\u0000${value}`),
  );
  if (missing.length) {
    throw new Error(
      `Vrednosti šifarnika nisu sačuvane: ${missing.map(({ value }) => value).join(", ")}.`,
    );
  }

  // Slugs are deterministic, but repair legacy rows that predate the current
  // normalizer. This is normally zero queries and preserves the old upsert
  // behavior without penalizing every save.
  const staleSlugs = desired.filter(({ kind, value, slug }) => {
    return found.get(`${kind}\u0000${value}`)?.slug !== slug;
  });
  for (const entry of staleSlugs) {
    await tx.productLookupValue.update({
      where: { kind_value: { kind: entry.kind, value: entry.value } },
      data: { slug: entry.slug },
    });
  }
  if (staleSlugs.length) {
    lookups = await tx.productLookupValue.findMany({
      where: { OR: desiredWhere },
      select: { id: true, kind: true, value: true, slug: true },
    });
  }

  await tx.productLookupAssignment.deleteMany({
    where: { productId, lookupValue: { kind: { in: kinds } } },
  });
  if (lookups.length) {
    await tx.productLookupAssignment.createMany({
      data: lookups.map(({ id: lookupValueId }) => ({
        productId,
        lookupValueId,
      })),
      skipDuplicates: true,
    });
  }
  return byKind;
}

export function composedArticleName(input: {
  collectionName?: string | null;
  shortDescription?: string | null;
  shortName?: string | null;
}) {
  const composed = composeArticleName({
    collection: input.collectionName,
    shortDescription: input.shortDescription,
    shortName: input.shortName,
  });
  if (!composed) throw new Error("Kratki naziv artikla je obavezan.");
  return composed;
}
