import "server-only";

import { Prisma } from "@prisma/client";
import {
  articleSlug,
  composeArticleName,
  normalizeArticleText,
  splitArticleValues,
} from "@/lib/article-master";
import {
  nextAvailableArticleSku,
  normalizeArticleSku,
  numericArticleSku,
} from "@/lib/article-sku";
import { ensureCategoryGroup } from "@/lib/category-groups.server";

const ARTICLE_SKU_LOCK_KEY = "spc:article-sku";

async function lockArticleSkuSpace(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ARTICLE_SKU_LOCK_KEY}))::text AS "lock"`;
}

export async function nextArticleSku(tx: Prisma.TransactionClient) {
  await lockArticleSkuSpace(tx);
  const products = await tx.product.findMany({ select: { sku: true } });
  return nextAvailableArticleSku(products.map(({ sku }) => sku));
}

export async function assertArticleSkuAvailable(
  tx: Prisma.TransactionClient,
  value: unknown,
  currentProductId?: string,
) {
  const sku = normalizeArticleSku(value);
  await lockArticleSkuSpace(tx);
  const products = await tx.product.findMany({
    where: currentProductId ? { id: { not: currentProductId } } : undefined,
    select: { sku: true },
  });
  const numeric = numericArticleSku(sku);
  const foldedSku = sku.toLocaleLowerCase("sr-Latn");
  const conflict = products.some(({ sku: existingSku }) =>
    existingSku.toLocaleLowerCase("sr-Latn") === foldedSku ||
    (numeric !== null && numericArticleSku(existingSku) === numeric),
  );
  if (conflict) throw new Error(`Šifra artikla ${sku} već postoji.`);
  return sku;
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
    await ensureCategoryGroup(tx, category);
    return category;
  }
  if (!name) return null;
  const parent = input.parentId
    ? await tx.category.findUnique({ where: { id: input.parentId } })
    : null;
  if (input.parentId && !parent) throw new Error("Nadređena kategorija ne postoji.");
  const slug = articleSlug(name);
  const path = `${parent?.path ?? ""}/${slug}`.replace(/\/+/g, "/");
  const category = await tx.category.upsert({
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
  await ensureCategoryGroup(tx, category);
  return category;
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
  const desiredWhere = desired.flatMap(({ kind, value, slug }) => [
    { kind, value },
    { kind, slug },
  ]);

  const currentAssignments = await tx.productLookupAssignment.findMany({
    where: { productId, lookupValue: { kind: { in: kinds } } },
    select: {
      lookupValue: {
        select: { kind: true, value: true, slug: true, active: true },
      },
    },
  });
  const desiredSignature = desired
    .map(({ kind, slug }) => `${kind}\u0000${slug}`)
    .sort();
  const currentSignature = currentAssignments
    .filter(({ lookupValue }) => lookupValue.active)
    .map(({ lookupValue }) => `${lookupValue.kind}\u0000${lookupValue.slug}`)
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
  }

  const candidates = desired.length
    ? await tx.productLookupValue.findMany({
        where: { OR: desiredWhere },
        select: { id: true, kind: true, value: true, slug: true },
      })
    : [];
  const foundByValue = new Map(
    candidates.map((lookup) => [`${lookup.kind}\u0000${lookup.value}`, lookup]),
  );
  const foundBySlug = new Map(
    candidates.map((lookup) => [`${lookup.kind}\u0000${lookup.slug}`, lookup]),
  );
  const resolved = desired.map(({ kind, value, slug }) =>
    foundByValue.get(`${kind}\u0000${value}`) ??
    foundBySlug.get(`${kind}\u0000${slug}`),
  );
  const missing = desired.filter((_entry, index) => !resolved[index]);
  if (missing.length) {
    throw new Error(
      `Vrednosti šifarnika nisu sačuvane: ${missing.map(({ value }) => value).join(", ")}.`,
    );
  }
  const lookups = Array.from(
    new Map(
      resolved
        .filter((lookup): lookup is NonNullable<typeof lookup> => Boolean(lookup))
        .map((lookup) => [lookup.id, lookup]),
    ).values(),
  );
  if (lookups.length) {
    await tx.productLookupValue.updateMany({
      where: { id: { in: lookups.map(({ id }) => id) } },
      data: { active: true },
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
