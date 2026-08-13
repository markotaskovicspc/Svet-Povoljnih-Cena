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
 * complete catalog. The approved business default counts audited DC stock and
 * fresh, approved Rabalux stock (with its safety buffer), but this guard must
 * stay off until the DC import/audit is complete and the client confirms that
 * supplier stock should participate. Set ENFORCE_WEB_AUTO_AVAILABILITY=true
 * only when that combined automatic availability is trustworthy.
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
    supplierStock: { gt: RABALUX_PUBLIC_STOCK_THRESHOLD },
    supplierApprovalStatus: "APPROVED",
    lastSupplierStockSyncAt: { gte: rabaluxStockFreshAfter(now) },
  };
}

/** Database predicate that mirrors the stock exposed by catalog DTOs. */
export function storefrontInStockWhere(now = new Date()): Prisma.ProductWhereInput {
  return {
    OR: [
      {
        AND: [nonRabaluxSupplierWhere(), { stock: { gt: 0 } }],
      },
      {
        AND: [
          {
            supplier: {
              is: { integrationKey: RABALUX_INTEGRATION_KEY },
            },
          },
          {
            OR: [
              { dcAvailableQty: { gt: 0 } },
              ...(isRabaluxEnabled()
                ? [
                    {
                      AND: [
                        { supplier: { is: { enabled: true } } },
                        rabaluxSupplierStockWhere(now),
                      ],
                    } satisfies Prisma.ProductWhereInput,
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
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
    AND: [nonRabaluxSupplierWhere(), { stock: { lte: 0 } }],
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
    buckets.push({
      AND: [ordinaryOutOfStock, { incomingStock: { lte: 0 } }],
    });
  }

  return { OR: buckets };
}

export function webStorefrontProductWhere(): Prisma.ProductWhereInput {
  const now = new Date();
  return {
    isActive: true,
    deletedAt: null,
    availableWebManual: true,
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
      ...(isWebAutoAvailabilityEnforced()
        ? [{ availableWebAuto: true } satisfies Prisma.ProductWhereInput]
        : []),
      {
        OR: [
          // PostgreSQL's three-valued NULL logic makes a relation-level
          // `NOT integrationKey = RABALUX` exclude ordinary suppliers whose
          // integration key is NULL. Spell out every non-Rabalux case so
          // those products remain eligible for the storefront.
          nonRabaluxSupplierWhere(),
          {
            AND: [
              {
                supplier: {
                  is: {
                    integrationKey: RABALUX_INTEGRATION_KEY,
                  },
                },
              },
              { articleStatus: { not: "ARH" } },
              {
                OR: [
                  { dcAvailableQty: { gt: 0 } },
                  ...(isRabaluxEnabled()
                    ? [
                        {
                          AND: [
                            { supplier: { is: { enabled: true } } },
                            rabaluxSupplierStockWhere(now),
                          ],
                        } satisfies Prisma.ProductWhereInput,
                      ]
                    : []),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function isProductAvailableOnWeb(product: WebAvailabilityProduct) {
  const generallyAvailable =
    !product.deletedAt &&
    product.isActive &&
    product.availableWebManual &&
    (!isWebAutoAvailabilityEnforced() || product.availableWebAuto);
  if (!generallyAvailable) return false;
  if (product.supplier?.integrationKey !== RABALUX_INTEGRATION_KEY) return true;
  if (product.articleStatus === "ARH") return false;

  if ((product.dcAvailableQty ?? 0) > 0) return true;
  return Boolean(
    product.supplier.enabled &&
      isRabaluxEnabled() &&
      product.supplierApprovalStatus === "APPROVED" &&
      (product.supplierStock ?? 0) > RABALUX_PUBLIC_STOCK_THRESHOLD &&
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
  if (isWebAutoAvailabilityEnforced() && !product.availableWebAuto) {
    reasons.push("Automatska web dostupnost je isključena");
  }
  if (!product.hasActiveRetailPrice) {
    reasons.push("Nema važeću pozitivnu stavku aktivnog MP cenovnika");
  }
  if (product.familyStorefrontEnabled === false) {
    reasons.push("Ova boja porodice nije uključena za web");
  }

  if (product.supplier?.integrationKey === RABALUX_INTEGRATION_KEY) {
    if (product.articleStatus === "ARH") reasons.push("Rabalux artikal je arhiviran");
    if ((product.dcAvailableQty ?? 0) <= 0) {
      if (!isRabaluxEnabled()) reasons.push("Rabalux integracija je isključena");
      if (!product.supplier.enabled) reasons.push("Rabalux dobavljač je isključen");
      if (product.supplierApprovalStatus !== "APPROVED") {
        reasons.push("Rabalux artikal nije odobren");
      }
      if ((product.supplierStock ?? 0) <= RABALUX_PUBLIC_STOCK_THRESHOLD) {
        reasons.push(
          `Rabalux stanje nije veće od praga ${RABALUX_PUBLIC_STOCK_THRESHOLD}`,
        );
      }
      if (!isRabaluxStockFresh(product.lastSupplierStockSyncAt)) {
        reasons.push("Rabalux stanje je zastarelo");
      }
    }
  }

  return Array.from(new Set(reasons));
}
