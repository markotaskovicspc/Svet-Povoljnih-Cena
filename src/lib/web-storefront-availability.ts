import "server-only";

import type { Prisma } from "@prisma/client";
import {
  RABALUX_PUBLIC_STOCK_THRESHOLD,
  isRabaluxStockFresh,
  rabaluxStockFreshAfter,
} from "@/lib/rabalux/availability";
import {
  RABALUX_INTEGRATION_KEY,
  isRabaluxEnabled,
} from "@/lib/rabalux/config";

type WebAvailabilityProduct = {
  isActive: boolean;
  deletedAt?: Date | string | null;
  availableWebManual: boolean;
  availableWebAuto: boolean;
  articleStatus?: string;
  stock?: number;
  dcAvailableQty?: number;
  supplierStock?: number | null;
  supplierApprovalStatus?: string | null;
  lastSupplierStockSyncAt?: Date | string | null;
  supplier?: {
    integrationKey?: string | null;
    enabled?: boolean;
  } | null;
};

type StorefrontPublicationProduct = WebAvailabilityProduct & {
  hasActiveRetailPrice: boolean;
  familyStorefrontEnabled?: boolean | null;
};

export type StorefrontAvailability =
  | "in-stock"
  | "incoming"
  | "out-of-stock";

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/**
 * Rollout guard for automatic web availability.
 *
 * Production currently has legacy catalog data but no populated DC balances.
 * Until those balances are imported and verified, the storefront keeps honoring
 * the manual Web check without allowing an all-false auto backfill to hide the
 * complete ordinary catalog. Rabalux publication is intentionally independent
 * of this guard: every approved XLSX row stays visible, while its weekly Serbia
 * quantity still controls purchasing. Keep the guard off until the DC
 * import/audit is complete.
 */
export function isWebAutoAvailabilityEnforced() {
  return enabled(process.env.ENFORCE_WEB_AUTO_AVAILABILITY);
}

function nonRabaluxSupplierWhere(): Prisma.ProductWhereInput {
  return {
    OR: [
      { supplier: { is: null } },
      { supplier: { is: { integrationKey: null } } },
      {
        supplier: {
          is: { integrationKey: { not: RABALUX_INTEGRATION_KEY } },
        },
      },
    ],
  };
}

function rabaluxSupplierStockWhere(now: Date): Prisma.ProductWhereInput {
  return {
    supplierStock: { gte: RABALUX_PUBLIC_STOCK_THRESHOLD },
    supplierApprovalStatus: "APPROVED",
    lastSupplierStockSyncAt: { gte: rabaluxStockFreshAfter(now) },
  };
}

function rabaluxSupplierWhere(): Prisma.ProductWhereInput {
  return {
    supplier: {
      is: { integrationKey: RABALUX_INTEGRATION_KEY },
    },
  };
}

function rabaluxUnavailableStockWhere(now: Date): Prisma.ProductWhereInput {
  if (!isRabaluxEnabled()) return rabaluxSupplierWhere();
  return {
    AND: [
      rabaluxSupplierWhere(),
      {
        OR: [
          { supplier: { is: { enabled: false } } },
          { supplierApprovalStatus: null },
          { supplierApprovalStatus: { not: "APPROVED" } },
          { supplierStock: null },
          { supplierStock: { lt: RABALUX_PUBLIC_STOCK_THRESHOLD } },
          { lastSupplierStockSyncAt: null },
          { lastSupplierStockSyncAt: { lt: rabaluxStockFreshAfter(now) } },
        ],
      },
    ],
  };
}

/** Database predicate that mirrors the stock exposed by catalog DTOs. */
export function storefrontInStockWhere(now = new Date()): Prisma.ProductWhereInput {
  const buckets: Prisma.ProductWhereInput[] = [
    {
      AND: [nonRabaluxSupplierWhere(), { dcAvailableQty: { gt: 0 } }],
    },
  ];
  if (isRabaluxEnabled()) {
    buckets.push({
      AND: [
        rabaluxSupplierWhere(),
        { supplier: { is: { enabled: true } } },
        rabaluxSupplierStockWhere(now),
      ],
    });
  }
  return { OR: buckets };
}

/**
 * Builds mutually exclusive stock buckets without negating nullable relation
 * predicates. PostgreSQL's three-valued NULL logic made `NOT in-stock` drop
 * ordinary products whose supplier integration key is NULL.
 */
export function storefrontAvailabilityWhere(
  selected: StorefrontAvailability[],
  now = new Date(),
): Prisma.ProductWhereInput {
  const buckets: Prisma.ProductWhereInput[] = [];
  const ordinaryOutOfStock: Prisma.ProductWhereInput = {
    AND: [nonRabaluxSupplierWhere(), { dcAvailableQty: { lte: 0 } }],
  };

  if (selected.includes("in-stock")) {
    buckets.push(storefrontInStockWhere(now));
  }
  if (selected.includes("incoming")) {
    buckets.push({
      AND: [ordinaryOutOfStock, { incomingStock: { gt: 0 } }],
    });
  }
  if (selected.includes("out-of-stock")) {
    buckets.push(
      {
        AND: [ordinaryOutOfStock, { incomingStock: { lte: 0 } }],
      },
      rabaluxUnavailableStockWhere(now),
    );
  }

  return { OR: buckets };
}

export function webStorefrontProductWhere(): Prisma.ProductWhereInput {
  const now = new Date();
  const enforceAutomaticAvailability = isWebAutoAvailabilityEnforced();
  return {
    isActive: true,
    deletedAt: null,
    availableWebManual: true,
    groupId: { not: null },
    categories: {
      some: { category: { parentId: { not: null } } },
    },
    priceListEntries: {
      some: {
        price: { gt: 0 },
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
    },
    AND: [
      ...(enforceAutomaticAvailability
        ? [
            {
              OR: [
                { availableWebAuto: true },
                // Rabalux 0-9 rows remain catalog-visible; this flag controls
                // purchasing for them, not publication.
                rabaluxSupplierWhere(),
              ],
            } satisfies Prisma.ProductWhereInput,
          ]
        : []),
      {
        OR: [
          // While the DC rollout guard is off, keep legacy SP items whose
          // aggregate balance is still empty. Once another warehouse has a
          // known positive balance, only audited DC stock may publish them.
          ...(!enforceAutomaticAvailability
            ? [
                {
                  AND: [
                    { articleStatus: "SP" },
                    nonRabaluxSupplierWhere(),
                    { stock: { lte: 0 } },
                  ],
                } satisfies Prisma.ProductWhereInput,
              ]
            : []),
          // PostgreSQL's three-valued NULL logic makes a relation-level
          // `NOT integrationKey = RABALUX` exclude ordinary suppliers whose
          // integration key is NULL. Spell out every non-Rabalux case so
          // those products remain eligible for the storefront.
          {
            AND: [
              nonRabaluxSupplierWhere(),
              { dcAvailableQty: { gt: 0 } },
            ],
          },
          {
            AND: [
              rabaluxSupplierWhere(),
              { articleStatus: { not: "ARH" } },
              { supplierApprovalStatus: "APPROVED" },
              { supplier: { is: { enabled: true } } },
            ],
          },
        ],
      },
    ],
  };
}

export function isProductAvailableOnWeb(product: WebAvailabilityProduct) {
  const enforceAutomaticAvailability = isWebAutoAvailabilityEnforced();
  const generallyAvailable =
    !product.deletedAt &&
    product.isActive &&
    product.availableWebManual &&
    (!enforceAutomaticAvailability || product.availableWebAuto);
  if (!generallyAvailable) return false;
  const dcAvailable = product.dcAvailableQty ?? product.stock ?? 0;
  if (product.supplier?.integrationKey !== RABALUX_INTEGRATION_KEY) {
    if (dcAvailable > 0) return true;
    return (
      !enforceAutomaticAvailability &&
      product.articleStatus === "SP" &&
      (product.stock ?? 0) <= 0
    );
  }
  if (product.articleStatus === "ARH") return false;

  return Boolean(
    product.supplier.enabled &&
      isRabaluxEnabled() &&
      product.supplierApprovalStatus === "APPROVED" &&
      (product.supplierStock ?? 0) >= RABALUX_PUBLIC_STOCK_THRESHOLD &&
      isRabaluxStockFresh(product.lastSupplierStockSyncAt),
  );
}

/** Human-readable mirror of every publication gate used by catalog queries. */
export function storefrontPublicationBlockers(
  product: StorefrontPublicationProduct,
) {
  const reasons: string[] = [];
  if (product.deletedAt) reasons.push("Artikal je arhiviran");
  if (!product.isActive) reasons.push("Artikal nije aktivan");
  if (!product.availableWebManual) reasons.push("Web kanal je ručno isključen");
  if (
    isWebAutoAvailabilityEnforced() &&
    product.supplier?.integrationKey !== RABALUX_INTEGRATION_KEY &&
    !product.availableWebAuto
  ) {
    reasons.push("Automatska web dostupnost je isključena");
  }
  if (!product.hasActiveRetailPrice) {
    reasons.push("Nema važeću pozitivnu stavku aktivnog MP cenovnika");
  }
  if (product.familyStorefrontEnabled === false) {
    reasons.push("Ova boja porodice nije uključena za web");
  }

  if (
    product.supplier?.integrationKey !== RABALUX_INTEGRATION_KEY &&
    (product.dcAvailableQty ?? product.stock ?? 0) <= 0 &&
    !(
      !isWebAutoAvailabilityEnforced() &&
      product.articleStatus === "SP" &&
      (product.stock ?? 0) <= 0
    )
  ) {
    reasons.push("Nema pozitivnu raspoloživu količinu");
  }

  if (
    product.supplier?.integrationKey === RABALUX_INTEGRATION_KEY
  ) {
    if (product.articleStatus === "ARH") reasons.push("Rabalux artikal je arhiviran");
    if (!isRabaluxEnabled()) reasons.push("Rabalux integracija je isključena");
    if (!product.supplier.enabled) reasons.push("Rabalux dobavljač je isključen");
    if (product.supplierApprovalStatus !== "APPROVED") {
      reasons.push("Rabalux artikal nije odobren");
    }
  }

  return Array.from(new Set(reasons));
}
