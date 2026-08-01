"use server";

import { revalidatePath, updateTag } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requireAdminAction,
  withAdminState,
  type AdminActionState,
} from "@/lib/admin";
import { parseBelgradePricingDateTime } from "@/lib/admin/pricing-date-time";
import { actionSalePriceError } from "@/lib/pricing/action-price";

export type PricingMutationResult = {
  entityId: string;
  mode: "create" | "update" | "delete";
};

const actionKinds = [
  "AKCIJA",
  "NEDELJNA",
  "HEROJI",
  "OGRANICENA",
  "OUTLET",
  "CUSTOM",
] as const;

const actionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(120).optional(),
  kind: z.enum(actionKinds).default("CUSTOM"),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  isHero: z.boolean().default(false),
  isPermanent: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
  priority: z.coerce.number().int().min(0).default(0),
});

const actionProductSchema = z.object({
  actionId: z.string().min(1),
  sku: z.string().trim().min(1).max(100),
  salePrice: z.coerce.number().positive(),
});

const loyaltySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  discountPct: z.coerce.number().gt(0).lte(100),
  scope: z.enum(["SELECTED_PRODUCTS", "ALL_PRODUCTS"]),
  productIds: z.array(z.string().min(1)).max(500).default([]),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(false),
});

const linearPromotionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  discountPct: z.coerce.number().gt(0).lte(100),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(false),
  categoryIds: z.array(z.string()).default([]),
  groupIds: z.array(z.string()).default([]),
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const actionProductDetailsInclude = {
  supplier: { select: { name: true } },
  group: { select: { name: true } },
  collection: { select: { name: true } },
  categories: {
    include: { category: { select: { name: true, level: true } } },
  },
} satisfies Prisma.ProductInclude;

type ActionProductDetails = Prisma.ProductGetPayload<{
  include: typeof actionProductDetailsInclude;
}>;

type ActionProductResolution =
  | { kind: "found"; product: ActionProductDetails }
  | { kind: "missing" }
  | { kind: "ambiguous"; skus: string[] };

function dateRange(startsAt: string, endsAt: string) {
  const start = parseBelgradePricingDateTime(startsAt);
  const end = parseBelgradePricingDateTime(endsAt);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    throw new Error("Datum završetka mora biti posle datuma početka.");
  }
  return { start, end };
}

async function resolveActionProduct(
  rawIdentifier: string,
): Promise<ActionProductResolution> {
  const identifier = rawIdentifier.trim();
  const exactSku = await db.product.findFirst({
    where: {
      deletedAt: null,
      sku: { equals: identifier, mode: "insensitive" },
    },
    include: actionProductDetailsInclude,
  });
  if (exactSku) return { kind: "found", product: exactSku };

  const alternatives = await db.product.findMany({
    where: {
      deletedAt: null,
      OR: [
        { barcode: { equals: identifier, mode: "insensitive" } },
        {
          supplierExternalId: { equals: identifier, mode: "insensitive" },
        },
        { sku: { endsWith: `-${identifier}`, mode: "insensitive" } },
      ],
    },
    orderBy: { sku: "asc" },
    take: 6,
    include: actionProductDetailsInclude,
  });
  if (!alternatives.length) return { kind: "missing" };
  if (alternatives.length > 1) {
    return {
      kind: "ambiguous",
      skus: alternatives.map((product) => product.sku),
    };
  }
  return { kind: "found", product: alternatives[0] };
}

function refreshPricing() {
  updateTag("catalog-pricing");
  updateTag("catalog-products");
  revalidatePath("/admin/erp/akcije");
  revalidatePath("/akcija");
  revalidatePath("/nedeljna-akcija");
  revalidatePath("/", "layout");
}

export async function upsertAction(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "action.upsert", entity: "Action" },
    async (_actorId, formData: FormData) => {
      const parsed = actionSchema.safeParse({
        ...Object.fromEntries(formData),
        isHero: formData.get("isHero") === "on",
        isPermanent: formData.get("isPermanent") === "on",
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Proverite podatke akcije.",
          fieldErrors: zodFieldErrors(parsed.error),
        };
      }

      const { id, ...values } = parsed.data;
      const { start, end } = dateRange(values.startsAt, values.endsAt);
      const data = {
        name: values.name,
        slug: values.slug || slugify(values.name),
        kind: values.kind,
        startsAt: start,
        endsAt: end,
        isHero: values.isHero,
        isPermanent: values.isPermanent,
        sortOrder: values.sortOrder,
        priority: values.priority,
      };
      const saved = id
        ? await db.action.update({ where: { id }, data })
        : await db.action.create({ data });
      refreshPricing();
      return {
        ok: true as const,
        entityId: saved.id,
        diff: data,
        message: id ? "Akcija je izmenjena." : "Akcija je kreirana.",
        result: {
          entityId: saved.id,
          mode: id ? ("update" as const) : ("create" as const),
        },
      };
    },
  )(formData);
}

export async function deleteAction(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "action.delete", entity: "Action" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID akcije." };
      await db.action.delete({ where: { id } });
      refreshPricing();
      return {
        ok: true as const,
        entityId: id,
        message: "Akcija je obrisana.",
        result: { entityId: id, mode: "delete" as const },
      };
    },
  )(formData);
}

async function retailPriceAt(productId: string, at: Date) {
  const entry = await db.priceListEntry.findFirst({
    where: {
      productId,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gte: at } }],
      priceList: {
        is: {
          kind: "RETAIL",
          active: true,
          AND: [
            {
              OR: [
                { name: { contains: "MP", mode: "insensitive" } },
                { code: { contains: "MP", mode: "insensitive" } },
              ],
            },
            { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
            { OR: [{ validTo: null }, { validTo: { gte: at } }] },
          ],
        },
      },
    },
    orderBy: { validFrom: "desc" },
    select: { price: true },
  });
  return entry ? Number(entry.price) : null;
}

function mapProductDetails(
  product: {
    id: string;
    sku: string;
    name: string;
    shortDescription: string | null;
    attribute1: string | null;
    attribute2: string | null;
    attribute3: string | null;
    attribute4: string | null;
    colorPrimary: string | null;
    colorSecondary: string | null;
    fullPrice: { toString(): string };
    supplier: { name: string } | null;
    group: { name: string } | null;
    collection: { name: string } | null;
    categories: Array<{
      category: { name: string; level: number };
    }>;
  },
  validMpPrice: number,
) {
  const categories = [...product.categories].sort(
    (left, right) => left.category.level - right.category.level,
  );
  return {
    productId: product.id,
    sku: product.sku,
    supplier: product.supplier?.name ?? "—",
    category: categories[0]?.category.name ?? "—",
    group: product.group?.name ?? "—",
    subgroup:
      categories.length > 1
        ? categories[categories.length - 1]?.category.name ?? "—"
        : "—",
    collection: product.collection?.name ?? "—",
    shortDescription: product.shortDescription ?? "—",
    shortName: product.name,
    attribute1: product.attribute1 ?? "—",
    attribute2: product.attribute2 ?? "—",
    attribute3: product.attribute3 ?? "—",
    attribute4: product.attribute4 ?? "—",
    color1: product.colorPrimary ?? "—",
    color2: product.colorSecondary ?? "—",
    validMpPrice,
  };
}

export async function lookupActionProduct(actionId: string, rawSku: string) {
  await requireAdminAction(["CONTENT"]);
  const identifier = rawSku.trim();
  if (!identifier) {
    return { ok: false as const, message: "Unesite šifru artikla." };
  }

  const [action, resolution] = await Promise.all([
    db.action.findUnique({
      where: { id: actionId },
      select: { startsAt: true },
    }),
    resolveActionProduct(identifier),
  ]);
  if (!action) return { ok: false as const, message: "Akcija nije pronađena." };
  if (resolution.kind === "missing") {
    return {
      ok: false as const,
      message: `Artikal sa šifrom „${identifier}“ nije pronađen.`,
    };
  }
  if (resolution.kind === "ambiguous") {
    return {
      ok: false as const,
      message: `Unos „${identifier}“ odgovara više artikala (${resolution.skus.join(", ")}). Unesite punu internu SKU šifru.`,
    };
  }
  const product = resolution.product;

  const retailPrice =
    (await retailPriceAt(product.id, action.startsAt)) ??
    Number(product.fullPrice);
  return {
    ok: true as const,
    product: mapProductDetails(product, retailPrice),
  };
}

export async function saveActionProduct(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "action.product.upsert",
      entity: "ActionProduct",
    },
    async (_actorId, formData: FormData) => {
      const parsed = actionProductSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Proverite šifru i akcijsku MP cenu.",
          fieldErrors: zodFieldErrors(parsed.error),
        };
      }
      const [action, resolution] = await Promise.all([
        db.action.findUnique({
          where: { id: parsed.data.actionId },
          select: { startsAt: true },
        }),
        resolveActionProduct(parsed.data.sku),
      ]);
      if (!action) {
        return { ok: false as const, error: "Akcija nije pronađena." };
      }
      if (resolution.kind === "missing") {
        return {
          ok: false as const,
          error: `Artikal sa šifrom „${parsed.data.sku}“ nije pronađen.`,
        };
      }
      if (resolution.kind === "ambiguous") {
        return {
          ok: false as const,
          error: `Unos „${parsed.data.sku}“ odgovara više artikala (${resolution.skus.join(", ")}). Unesite punu internu SKU šifru.`,
        };
      }
      const product = resolution.product;
      const regularPrice =
        (await retailPriceAt(product.id, action.startsAt)) ??
        Number(product.fullPrice);
      const priceError = actionSalePriceError(
        parsed.data.salePrice,
        regularPrice,
      );
      if (priceError) {
        return {
          ok: false as const,
          error: priceError,
          fieldErrors: { salePrice: [priceError] },
        };
      }

      await db.$transaction([
        db.actionProduct.upsert({
          where: {
            actionId_productId: {
              actionId: parsed.data.actionId,
              productId: product.id,
            },
          },
          create: {
            actionId: parsed.data.actionId,
            productId: product.id,
            salePrice: parsed.data.salePrice,
          },
          update: { salePrice: parsed.data.salePrice },
        }),
        db.action.update({
          where: { id: parsed.data.actionId },
          data: { products: { connect: { id: product.id } } },
        }),
      ]);
      refreshPricing();
      return {
        ok: true as const,
        entityId: `${parsed.data.actionId}:${product.id}`,
        diff: {
          sku: product.sku,
          salePrice: parsed.data.salePrice,
          regularPrice,
        },
        message: "Akcijska cena je sačuvana.",
        result: {
          entityId: `${parsed.data.actionId}:${product.id}`,
          mode: "update" as const,
        },
      };
    },
  )(formData);
}

export async function deleteActionProduct(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "action.product.delete",
      entity: "ActionProduct",
    },
    async (_actorId, formData: FormData) => {
      const actionId = String(formData.get("actionId") ?? "");
      const productId = String(formData.get("productId") ?? "");
      if (!actionId || !productId) {
        return { ok: false as const, error: "Nedostaje veza akcije i artikla." };
      }
      await db.$transaction([
        db.actionProduct.delete({
          where: { actionId_productId: { actionId, productId } },
        }),
        db.action.update({
          where: { id: actionId },
          data: { products: { disconnect: { id: productId } } },
        }),
      ]);
      refreshPricing();
      return {
        ok: true as const,
        entityId: `${actionId}:${productId}`,
        message: "Artikal je uklonjen iz akcije.",
        result: {
          entityId: `${actionId}:${productId}`,
          mode: "delete" as const,
        },
      };
    },
  )(formData);
}

export async function upsertLoyaltyRule(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "loyalty.upsert", entity: "LoyaltyRule" },
    async (_actorId, formData: FormData) => {
      const parsed = loyaltySchema.safeParse({
        ...Object.fromEntries(formData),
        active: formData.get("active") === "on",
        productIds: formData.getAll("productIds").map(String),
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Proverite loyalty pravilo.",
          fieldErrors: zodFieldErrors(parsed.error),
        };
      }
      const { start, end } = dateRange(
        parsed.data.startsAt,
        parsed.data.endsAt,
      );
      const { id, productIds: submittedProductIds, ...values } = parsed.data;
      const productIds = Array.from(new Set(submittedProductIds));
      const existingProducts = productIds.length
        ? await db.product.findMany({
            where: { id: { in: productIds }, deletedAt: null },
            select: { id: true },
          })
        : [];
      if (existingProducts.length !== productIds.length) {
        return {
          ok: false as const,
          error: "Jedan ili više izabranih artikala više ne postoje.",
        };
      }
      const data = {
        name: values.name,
        discountPct: values.discountPct,
        scope: values.scope,
        priority: values.priority,
        startsAt: start,
        endsAt: end,
        active: values.active,
      };
      let saved;
      let message = "Loyalty pravilo je dodato u istoriju.";
      if (!id) {
        saved = await db.loyaltyRule.create({
          data: {
            ...data,
            products: {
              create: productIds.map((productId) => ({ productId })),
            },
          },
        });
      } else {
        const current = await db.loyaltyRule.findUnique({ where: { id } });
        if (!current) {
          return {
            ok: false as const,
            error: "Loyalty pravilo nije pronađeno.",
          };
        }
        if (Number(current.discountPct) !== values.discountPct) {
          saved = await db.$transaction(async (tx) => {
            await tx.loyaltyRule.update({
              where: { id },
              data: { active: false },
            });
            return tx.loyaltyRule.create({
              data: {
                ...data,
                products: {
                  create: productIds.map((productId) => ({ productId })),
                },
              },
            });
          });
          message =
            "Novi procenat je dodat kao novi zapis; prethodni je sačuvan u istoriji i deaktiviran.";
        } else {
          saved = await db.$transaction(async (tx) => {
            const updated = await tx.loyaltyRule.update({ where: { id }, data });
            await tx.loyaltyRuleProduct.deleteMany({
              where: { loyaltyRuleId: id },
            });
            if (productIds.length) {
              await tx.loyaltyRuleProduct.createMany({
                data: productIds.map((productId) => ({
                  loyaltyRuleId: id,
                  productId,
                })),
              });
            }
            return updated;
          });
          message = "Loyalty pravilo je izmenjeno.";
        }
      }
      refreshPricing();
      return {
        ok: true as const,
        entityId: saved.id,
        diff: { previousId: id ?? null, ...values, productIds },
        message,
        result: {
          entityId: saved.id,
          mode: id ? ("update" as const) : ("create" as const),
        },
      };
    },
  )(formData);
}

export async function searchLoyaltyProducts(rawQuery: string) {
  await requireAdminAction(["CONTENT"]);
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  return db.product.findMany({
    where: {
      deletedAt: null,
      OR: [
        { sku: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { barcode: { contains: query, mode: "insensitive" } },
        { supplierExternalId: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ name: "asc" }, { sku: "asc" }],
    take: 20,
    select: { id: true, sku: true, name: true },
  });
}

export async function deleteLoyaltyRule(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "loyalty.delete", entity: "LoyaltyRule" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        return { ok: false as const, error: "Nedostaje ID loyalty pravila." };
      }
      await db.loyaltyRule.delete({ where: { id } });
      refreshPricing();
      return {
        ok: true as const,
        entityId: id,
        message: "Loyalty zapis je obrisan.",
        result: { entityId: id, mode: "delete" as const },
      };
    },
  )(formData);
}

export async function upsertLinearPromotion(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "linear-promotion.upsert",
      entity: "LinearPromotion",
    },
    async (_actorId, formData: FormData) => {
      const parsed = linearPromotionSchema.safeParse({
        ...Object.fromEntries(formData),
        categoryIds: formData.getAll("categoryIds").map(String),
        groupIds: formData.getAll("groupIds").map(String),
        active: formData.get("active") === "on",
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Proverite podatke linearne promocije.",
          fieldErrors: zodFieldErrors(parsed.error),
        };
      }
      const { start, end } = dateRange(
        parsed.data.startsAt,
        parsed.data.endsAt,
      );
      const { id, ...values } = parsed.data;
      const target = values.categoryIds.length
        ? ("CATEGORY" as const)
        : values.groupIds.length
          ? ("GROUP" as const)
          : ("ALL" as const);
      const data = {
        name: values.name,
        discountPct: values.discountPct,
        priority: values.priority,
        startsAt: start,
        endsAt: end,
        active: values.active,
        target,
      };
      const saved = id
        ? await db.$transaction(async (tx) => {
            await tx.linearPromotionCategory.deleteMany({
              where: { promotionId: id },
            });
            await tx.linearPromotionGroup.deleteMany({
              where: { promotionId: id },
            });
            return tx.linearPromotion.update({
              where: { id },
              data: {
                ...data,
                categories: {
                  create: values.categoryIds.map((categoryId) => ({
                    categoryId,
                  })),
                },
                groups: {
                  create: values.groupIds.map((groupId) => ({ groupId })),
                },
              },
            });
          })
        : await db.linearPromotion.create({
            data: {
              ...data,
              categories: {
                create: values.categoryIds.map((categoryId) => ({
                  categoryId,
                })),
              },
              groups: {
                create: values.groupIds.map((groupId) => ({ groupId })),
              },
            },
          });
      refreshPricing();
      return {
        ok: true as const,
        entityId: saved.id,
        diff: values,
        message: id
          ? "Linearna promocija je izmenjena."
          : "Linearna promocija je kreirana.",
        result: {
          entityId: saved.id,
          mode: id ? ("update" as const) : ("create" as const),
        },
      };
    },
  )(formData);
}

export async function deleteLinearPromotion(
  _state: AdminActionState<PricingMutationResult>,
  formData: FormData,
) {
  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "linear-promotion.delete",
      entity: "LinearPromotion",
    },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        return {
          ok: false as const,
          error: "Nedostaje ID linearne promocije.",
        };
      }
      await db.linearPromotion.delete({ where: { id } });
      refreshPricing();
      return {
        ok: true as const,
        entityId: id,
        message: "Linearna promocija je obrisana.",
        result: { entityId: id, mode: "delete" as const },
      };
    },
  )(formData);
}

function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(error.flatten().fieldErrors).filter(
      (entry): entry is [string, string[]] => Array.isArray(entry[1]),
    ),
  );
}
