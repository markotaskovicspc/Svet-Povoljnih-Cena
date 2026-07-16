import "server-only";
import { envValue } from "@/lib/env";

import { Prisma, type Supplier } from "@prisma/client";
import { db } from "@/lib/db";
import { connectorFor } from "./connector";
import type {
  FeedItem,
  ImportSummary,
  SupplierConfig,
  SupplierFeedMapping,
} from "./types";

/**
 * Phase 4A orchestrator — runs an import for one supplier end-to-end.
 *
 * Flow:
 *   1. Open an `ImportRun` row (status=RUNNING) for observability.
 *   2. Fetch + parse via the connector. Hard fail → mark FAILED, return.
 *   3. For each `FeedItem`:
 *        a. Resolve category tree (upsert each level by materialized path).
 *        b. Resolve group / collection / action / pictograms / materials.
 *        c. Upsert the product itself, plus media (delete-and-replace).
 *        d. Snapshot stock into `SupplierStockSnapshot`.
 *   4. Apply auto-disable: any product with stock == 0 && incomingStock == 0,
 *      OR below an applicable `SafetyStockRule`, gets `isActive = false`.
 *   5. Close the `ImportRun` with SUCCESS / PARTIAL / FAILED + counters.
 *
 * Each item is processed in its own transaction so a single bad row never
 * tanks the whole run; per-item errors are recorded on the `ImportRun`.
 */

const MAX_ERRORS_RECORDED = 50;

export interface ImportSupplierOptions {
  dryRun?: boolean;
}

function isMapping(value: unknown): value is SupplierFeedMapping {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SupplierFeedMapping).itemPath === "string" &&
    typeof (value as SupplierFeedMapping).externalId === "string" &&
    typeof (value as SupplierFeedMapping).name === "string" &&
    typeof (value as SupplierFeedMapping).fullPrice === "string" &&
    typeof (value as SupplierFeedMapping).stock === "string"
  );
}

function toConfig(supplier: Supplier): SupplierConfig | null {
  if (!supplier.feedUrl) return null;
  if (!isMapping(supplier.mapping)) return null;
  return {
    id: supplier.id,
    name: supplier.name,
    feedUrl: supplier.feedUrl,
    authUser: resolveSupplierSecret(supplier, "USER", supplier.authUser),
    authPass: resolveSupplierSecret(supplier, "PASS", supplier.authPass),
    enabled: supplier.enabled,
    mapping: supplier.mapping,
  };
}

function resolveSupplierSecret(
  supplier: Supplier,
  suffix: "USER" | "PASS",
  fallback: string | null,
) {
  const explicitEnv = fallback?.match(/^env:([A-Z0-9_]+)$/i)?.[1];
  if (explicitEnv) return envValue(explicitEnv);

  const candidates = [
    supplier.code,
    supplier.name,
    supplier.id,
  ]
    .filter(Boolean)
    .map((value) => String(value).replace(/[^A-Za-z0-9]+/g, "_").toUpperCase())
    .map((token) => `XML_SUPPLIER_${token}_${suffix}`);

  for (const key of candidates) {
    const value = envValue(key);
    if (value) return value;
  }
  return fallback;
}

/** Run imports for every enabled, fully-configured supplier. */
export async function importAllSuppliers(
  opts: ImportSupplierOptions = {},
): Promise<ImportSummary[]> {
  const suppliers = await db.supplier.findMany({ where: { enabled: true } });
  const out: ImportSummary[] = [];
  for (const s of suppliers) {
    try {
      out.push(await importSupplier(s.id, opts));
    } catch (err) {
      // importSupplier already records its own ImportRun row; this is for
      // truly catastrophic failures (e.g., DB unreachable) where we still
      // want to surface a summary entry.
      out.push({
        supplierId: s.id,
        importRunId: "",
        startedAt: new Date(),
        finishedAt: new Date(),
        read: 0,
        ok: 0,
        failed: 1,
        created: 0,
        updated: 0,
        disabled: 0,
        errors: [{ message: err instanceof Error ? err.message : String(err) }],
      });
    }
  }
  return out;
}

export async function importSupplier(
  supplierId: string,
  opts: ImportSupplierOptions = {},
): Promise<ImportSummary> {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);
  const config = toConfig(supplier);

  const run = await db.importRun.create({
    data: { supplierId, status: "RUNNING", dryRun: opts.dryRun ?? false },
  });

  const errors: ImportSummary["errors"] = [];
  let read = 0;
  let ok = 0;
  let failed = 0;
  let created = 0;
  let updated = 0;
  let disabled = 0;
  const startedAt = run.startedAt;

  const close = async (status: "SUCCESS" | "PARTIAL" | "FAILED", message?: string) => {
    const finishedAt = new Date();
    await db.importRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        recordsRead: read,
        recordsOk: ok,
        recordsFail: failed,
        errorMessage: message ?? (errors.length ? errors[0].message : null),
        errors: errors.length ? (errors as Prisma.InputJsonValue) : undefined,
      },
    });
    return {
      supplierId,
      importRunId: run.id,
      startedAt,
      finishedAt,
      read,
      ok,
      failed,
      created,
      updated,
      disabled,
      errors,
    } satisfies ImportSummary;
  };

  if (!config) {
    return close(
      "FAILED",
      "Supplier missing feedUrl or mapping; configure both before running an import.",
    );
  }

  const connector = connectorFor(config);
  let items: FeedItem[];
  try {
    const raw = await connector.fetchRaw();
    items = connector.parse(raw);
  } catch (err) {
    return close(
      "FAILED",
      err instanceof Error ? err.message : `Feed fetch/parse failed: ${String(err)}`,
    );
  }

  read = items.length;
  const seenExternalIds = new Set<string>();

  for (const item of items) {
    seenExternalIds.add(item.externalId);
    try {
      const validationErrors = validateFeedItem(item);
      if (validationErrors.length) {
        throw new Error(validationErrors.join("; "));
      }
      if (opts.dryRun) {
        ok++;
        continue;
      }
      const result = await upsertFeedItem(item, supplierId);
      if (result === "created") created++;
      else updated++;
      ok++;
    } catch (err) {
      failed++;
      if (errors.length < MAX_ERRORS_RECORDED) {
        errors.push({
          externalId: item.externalId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Auto-disable rule: applies to every product belonging to this supplier,
  // regardless of whether it appeared in this run (a product that drops out
  // of the feed should not stay live).
  disabled = opts.dryRun ? 0 : await applyAutoDisable(supplierId);

  const status: "SUCCESS" | "PARTIAL" = failed === 0 ? "SUCCESS" : "PARTIAL";
  return close(status);
}

function validateFeedItem(item: FeedItem) {
  const errors: string[] = [];
  if (!item.externalId?.trim()) errors.push("externalId is required");
  if (!item.sku?.trim()) errors.push("sku is required");
  if (!item.name?.trim()) errors.push("name is required");
  if (!Number.isFinite(item.fullPrice) || item.fullPrice <= 0) {
    errors.push("fullPrice must be a positive number");
  }
  if (!Number.isInteger(item.stock) || item.stock < 0) {
    errors.push("stock must be a non-negative integer");
  }
  if (item.incomingStock != null && (!Number.isInteger(item.incomingStock) || item.incomingStock < 0)) {
    errors.push("incomingStock must be a non-negative integer");
  }
  if (!item.categoryPath?.length) errors.push("categoryPath is required");
  if (!item.groupSlug?.trim()) errors.push("groupSlug is required");
  return errors;
}

function parseSyncOverrideFields(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Set<string>();
  }
  const fields = (value as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return new Set<string>();
  return new Set(
    fields
      .map((field) => (typeof field === "string" ? field.trim() : ""))
      .filter(Boolean),
  );
}

function applyProductOverrides(
  data: Prisma.ProductUncheckedCreateInput,
  fields: Set<string>,
): Prisma.ProductUncheckedUpdateInput {
  const out: Record<string, unknown> = { ...data };
  const groups: Record<string, string[]> = {
    identity: ["sku", "slug", "name", "description", "shortDescription"],
    name: ["name"],
    description: ["description", "shortDescription"],
    pricing: ["fullPrice", "salePrice", "discountPct", "actionId"],
    price: ["fullPrice", "salePrice", "discountPct", "actionId"],
    stock: ["stock", "incomingStock", "supplierStock", "isActive"],
    flags: ["isHero", "isNew", "newUntil", "isLimited", "isDtz"],
    dimensions: ["widthCm", "depthCm", "heightCm"],
    delivery: ["deliveryDaysMin", "deliveryDaysMax", "allowsAssembly"],
    grouping: ["groupId", "collectionId"],
  };
  for (const field of fields) {
    for (const key of groups[field] ?? [field]) {
      delete out[key];
    }
  }
  return out as Prisma.ProductUncheckedUpdateInput;
}

async function upsertFeedItem(
  item: FeedItem,
  supplierId: string,
): Promise<"created" | "updated"> {
  return db.$transaction(async (tx) => {
    const categoryId = item.categoryPath?.length
      ? await ensureCategory(tx, item.categoryPath)
      : null;
    const groupId = item.groupSlug
      ? await ensureGroup(tx, item.groupSlug)
      : null;
    const collectionId = item.collectionSlug
      ? await ensureCollection(tx, item.collectionSlug)
      : null;
    const actionId = item.action ? await ensureAction(tx, item.action) : null;

    // Identify by SKU first (public, stable). Fall back to supplier+external.
    const existing = await tx.product.findFirst({
      where: {
        OR: [
          { sku: item.sku },
          { supplierId, supplierExternalId: item.externalId },
        ],
      },
      select: { id: true, syncOverrides: true },
    });

    const slug = item.slug ?? item.sku.toLowerCase();
    const data: Prisma.ProductUncheckedCreateInput = {
      sku: item.sku,
      slug,
      name: item.name,
      description: item.description ?? "",
      shortDescription: item.shortDescription ?? null,
      groupId,
      collectionId,
      widthCm: item.widthCm != null ? new Prisma.Decimal(item.widthCm) : null,
      depthCm: item.depthCm != null ? new Prisma.Decimal(item.depthCm) : null,
      heightCm: item.heightCm != null ? new Prisma.Decimal(item.heightCm) : null,
      fullPrice: new Prisma.Decimal(item.fullPrice),
      salePrice:
        item.salePrice != null ? new Prisma.Decimal(item.salePrice) : null,
      discountPct: item.discountPct ?? null,
      actionId,
      isHero: item.isHero ?? false,
      isNew: item.isNew ?? false,
      newUntil: item.newUntil ?? null,
      isLimited: item.isLimited ?? false,
      isDtz: item.isDtz ?? false,
      // Owned warehouse stock is authoritative and is never sourced from a
      // supplier availability feed. New products start with no owned stock.
      stock: 0,
      incomingStock: item.incomingStock ?? 0,
      supplierStock: item.supplierStock ?? item.stock,
      deliveryDaysMin: item.deliveryDaysMin ?? 3,
      deliveryDaysMax: item.deliveryDaysMax ?? 5,
      allowsAssembly: item.allowsAssembly ?? false,
      supplierId,
      supplierExternalId: item.externalId,
      // Activity is recomputed by `applyAutoDisable` after the run; the
      // import itself trusts the feed (anything imported is at least live
      // candidate material).
      isActive: true,
    };

    let productId: string;
    let kind: "created" | "updated";
    const overrides = existing ? parseSyncOverrideFields(existing.syncOverrides) : new Set<string>();
    const productData = existing ? applyProductOverrides(data, overrides) : data;

    if (existing) {
      delete (productData as Record<string, unknown>).stock;
      await tx.product.update({ where: { id: existing.id }, data: productData });
      productId = existing.id;
      kind = "updated";
    } else {
      const fresh = await tx.product.create({ data, select: { id: true } });
      productId = fresh.id;
      kind = "created";
    }

    if (categoryId && !overrides.has("categories") && !overrides.has("category")) {
      // Replace the category links (a product can move between categories
      // across imports). Re-creating the join row is cheap and keeps logic
      // simple compared to diffing.
      await tx.productCategory.deleteMany({ where: { productId } });
      await tx.productCategory.create({ data: { productId, categoryId } });
    }

    if (item.media && !overrides.has("media") && !overrides.has("images")) {
      await tx.productMedia.deleteMany({ where: { productId } });
      await tx.productMedia.createMany({
        data: item.media.map((m, idx) => ({
          productId,
          url: m.url,
          alt: m.alt ?? null,
          kind:
            m.kind === "video"
              ? "VIDEO"
              : m.kind === "video3d"
                ? "VIDEO_3D"
                : "IMAGE",
          order: m.order ?? idx,
        })),
      });
    }

    if (item.pictograms?.length && !overrides.has("pictograms")) {
      const pictoIds: string[] = [];
      for (const p of item.pictograms) {
        const row = await tx.pictogram.upsert({
          where: { code: p.code },
          create: {
            code: p.code,
            label: p.label ?? p.code,
            iconUrl: p.iconUrl ?? "",
          },
          update: {
            ...(p.label ? { label: p.label } : {}),
            ...(p.iconUrl ? { iconUrl: p.iconUrl } : {}),
          },
        });
        pictoIds.push(row.id);
      }
      await tx.productPictogram.deleteMany({ where: { productId } });
      await tx.productPictogram.createMany({
        data: pictoIds.map((pictogramId) => ({ productId, pictogramId })),
      });
    }

    if (item.materials?.length && !overrides.has("materials")) {
      const matIds: string[] = [];
      for (const m of item.materials) {
        const row = await tx.material.upsert({
          where: { slug: m.slug },
          create: {
            slug: m.slug,
            label: m.label ?? m.slug,
            imageUrl: m.imageUrl ?? null,
          },
          update: m.imageUrl ? { imageUrl: m.imageUrl } : {},
        });
        matIds.push(row.id);
      }
      await tx.productMaterial.deleteMany({ where: { productId } });
      await tx.productMaterial.createMany({
        data: matIds.map((materialId) => ({ productId, materialId })),
      });
    }

    await tx.supplierStockSnapshot.create({
      data: {
        supplierId,
        productId,
        externalSku: item.externalId,
        stock: item.stock,
        incomingStock: item.incomingStock ?? 0,
      },
    });

    return kind;
  });
}

async function ensureCategory(
  tx: Prisma.TransactionClient,
  segments: string[],
): Promise<string> {
  let parentId: string | null = null;
  let path = "";
  let level = 0;
  let lastId = "";
  for (const segment of segments) {
    const slug = slugify(segment);
    path = `${path}/${slug}`;
    const existing = await tx.category.findUnique({ where: { path } });
    if (existing) {
      parentId = existing.id;
      lastId = existing.id;
    } else {
      const created: { id: string } = await tx.category.create({
        data: {
          slug,
          name: segment,
          path,
          level,
          parentId,
        },
        select: { id: true },
      });
      parentId = created.id;
      lastId = created.id;
    }
    level++;
  }
  return lastId;
}

async function ensureGroup(
  tx: Prisma.TransactionClient,
  slug: string,
): Promise<string> {
  const norm = slugify(slug);
  const row = await tx.group.upsert({
    where: { slug: norm },
    create: { slug: norm, name: slug },
    update: {},
  });
  return row.id;
}

async function ensureCollection(
  tx: Prisma.TransactionClient,
  slug: string,
): Promise<string> {
  const norm = slugify(slug);
  const row = await tx.collection.upsert({
    where: { slug: norm },
    create: { slug: norm, name: slug },
    update: {},
  });
  return row.id;
}

async function ensureAction(
  tx: Prisma.TransactionClient,
  action: NonNullable<FeedItem["action"]>,
): Promise<string> {
  const slug = slugify(action.slug);
  const row = await tx.action.upsert({
    where: { slug },
    create: {
      slug,
      name: action.name,
      kind: "CUSTOM",
      startsAt: action.startsAt,
      endsAt: action.endsAt,
      isHero: action.isHero ?? false,
    },
    update: {
      name: action.name,
      startsAt: action.startsAt,
      endsAt: action.endsAt,
      isHero: action.isHero ?? false,
    },
  });
  return row.id;
}

/**
 * Auto-disable rule (per spec, Phase 4A item 5):
 *   - stock == 0 && incomingStock == 0  →  isActive = false.
 *   - stock < threshold (matching SafetyStockRule for this supplier and,
 *     optionally, this product's category path)  →  isActive = false.
 *
 * Returns the count of products that were either flipped to inactive or
 * re-activated (sum of both). Re-activation happens automatically when a
 * product's stock comes back above all applicable thresholds.
 */
async function applyAutoDisable(supplierId: string): Promise<number> {
  const rules = await db.safetyStockRule.findMany({
    where: { OR: [{ supplierId }, { supplierId: null }] },
  });
  const products = await db.product.findMany({
    where: { supplierId },
    select: {
      id: true,
      stock: true,
      incomingStock: true,
      supplierStock: true,
      isActive: true,
      categories: { select: { category: { select: { path: true } } } },
    },
  });

  let changed = 0;
  for (const p of products) {
    let shouldBeActive = !(
      p.stock === 0 &&
      p.incomingStock === 0 &&
      (p.supplierStock ?? 0) === 0
    );
    if (shouldBeActive) {
      for (const rule of rules) {
        if (rule.categoryPath) {
          const inScope = p.categories.some((c) =>
            c.category.path.startsWith(rule.categoryPath!),
          );
          if (!inScope) continue;
        }
        if (p.stock < rule.threshold) {
          shouldBeActive = false;
          break;
        }
      }
    }
    if (shouldBeActive !== p.isActive) {
      await db.product.update({
        where: { id: p.id },
        data: { isActive: shouldBeActive },
      });
      changed++;
    }
  }
  return changed;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}
