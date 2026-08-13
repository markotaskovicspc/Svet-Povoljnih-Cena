import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const RABALUX_INTEGRATION_KEY = "RABALUX";
const RABALUX_PUBLIC_STOCK_THRESHOLD = 10;
const RABALUX_SUPPLIER_SAFETY_STOCK = 1;
const RABALUX_STOCK_MAX_AGE_MS = 30 * 60 * 1_000;
const connectionString = getConnectionString();
const missingStorageSchemaRequested =
  process.env.RUNTIME_READINESS_ALLOW_MISSING_STORAGE_SCHEMA === "true";
const missingStorageSchemaAllowed =
  missingStorageSchemaRequested && isLocalDatabase(connectionString);
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: withDatabaseSsl(connectionString),
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  }),
});

const errors = [];
const warnings = [];

if (missingStorageSchemaRequested && !missingStorageSchemaAllowed) {
  errors.push(
    "RUNTIME_READINESS_ALLOW_MISSING_STORAGE_SCHEMA is restricted to localhost QA databases.",
  );
}

try {
  // This check deliberately uses a one-connection pool. Run its queries in
  // sequence so queued requests do not exhaust their connection-acquisition
  // timeout while a preceding production query is still using that connection.
  const now = new Date();
  const products = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      sku: true,
      stock: true,
      dcAvailableQty: true,
      supplierStock: true,
      supplierReservedStock: true,
      supplierApprovalStatus: true,
      lastSupplierStockSyncAt: true,
      articleStatus: true,
      availableWebManual: true,
      availableWebAuto: true,
      fullPrice: true,
      salePrice: true,
      widthCm: true,
      depthCm: true,
      heightCm: true,
      deliveryDaysMin: true,
      deliveryDaysMax: true,
      media: { select: { id: true }, take: 1 },
      warehouseStocks: { select: { qty: true } },
      supplier: {
        select: { integrationKey: true, enabled: true },
      },
      priceListEntries: {
        where: {
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
        select: { id: true },
        take: 1,
      },
    },
  });
  const payments = await prisma.paymentMethodConfig.findMany({
    where: { enabled: true },
    select: { method: true },
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { active: true },
    select: { code: true, isDefault: true },
  });
  const emailStatuses = await prisma.emailMessage.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const shipmentStatuses = await prisma.shipment.groupBy({
    by: ["provider", "status"],
    _count: { _all: true },
  });
  const fiscalStatuses = await prisma.fiscalDocument.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const backgroundStatuses = await prisma.backgroundJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const migrationRows = await prisma.$queryRawUnsafe(
    `SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations"`,
  );
  const rlsViolations = await prisma.$queryRawUnsafe(`
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relrowsecurity
     ORDER BY c.relname
  `);
  const apiGrants = await prisma.$queryRawUnsafe(`
    SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND grantee IN ('anon', 'authenticated')
     ORDER BY grantee, table_name, privilege_type
  `);

  let storageSchemaAvailable = true;
  let storageBuckets = [];
  try {
    storageBuckets = await prisma.$queryRawUnsafe(`
      SELECT id, public
        FROM storage.buckets
       WHERE id IN (
         'product-media',
         'fiscal-receipts',
         'order-receipts',
         'reclamation-uploads',
         'shipment-labels'
       )
       ORDER BY id
    `);
  } catch (error) {
    if (!isMissingStorageSchemaError(error)) throw error;
    storageSchemaAvailable = false;
    if (missingStorageSchemaAllowed) {
      warnings.push(
        "Supabase storage schema is unavailable in this isolated localhost QA database; bucket policy requires a separate Supabase environment check.",
      );
    } else {
      errors.push(
        "Supabase storage schema is missing; set up storage before release readiness can pass.",
      );
    }
  }

  const catalog = products.map((product) => {
    const reasons = [];
    const publicationBlockers = [];
    const price = Number(product.salePrice ?? product.fullPrice);
    if (!Number.isFinite(price) || price <= 0) reasons.push("invalid_price");
    if (
      ![product.widthCm, product.depthCm, product.heightCm].every(
        (value) => value !== null && Number(value) > 0,
      )
    ) {
      reasons.push("missing_dimensions");
    }
    if (!product.media.length) reasons.push("missing_media");
    if (
      product.deliveryDaysMin < 0 ||
      product.deliveryDaysMax < product.deliveryDaysMin
    ) {
      reasons.push("invalid_delivery_window");
    }
    const warehouseStock = product.warehouseStocks.reduce(
      (sum, item) => sum + item.qty,
      0,
    );
    const availability = checkoutAvailability(product, now);
    if (!product.availableWebManual) publicationBlockers.push("web_manual_disabled");
    if (enabledEnv("ENFORCE_WEB_AUTO_AVAILABILITY") && !product.availableWebAuto) {
      publicationBlockers.push("web_auto_disabled");
    }
    if (!product.priceListEntries.length) {
      publicationBlockers.push("missing_active_retail_price");
    }
    if (
      product.supplier?.integrationKey === RABALUX_INTEGRATION_KEY &&
      product.articleStatus === "ARH"
    ) {
      publicationBlockers.push("rabalux_archived");
    }
    if (
      product.supplier?.integrationKey === RABALUX_INTEGRATION_KEY &&
      !availability.publicationEligible
    ) {
      publicationBlockers.push("rabalux_unavailable");
    }
    return {
      sku: product.sku,
      stock: product.stock,
      warehouseStock,
      ready: reasons.length === 0,
      reasons,
      published: publicationBlockers.length === 0,
      publicationBlockers,
      ...availability,
    };
  });
  const ready = catalog.filter((product) => product.ready);
  const published = catalog.filter((product) => product.published);
  const checkoutSellable = published.filter((product) => product.sellableStock > 0);
  const purchasable = checkoutSellable.filter((product) => product.ready);
  const reasonCounts = Object.fromEntries(
    ["invalid_price", "missing_dimensions", "missing_media", "invalid_delivery_window"].map(
      (reason) => [
        reason,
        catalog.filter((product) => product.reasons.includes(reason)).length,
      ],
    ),
  );
  const stockMismatches = catalog.filter(
    (product) => product.stock !== product.warehouseStock,
  );

  if (!purchasable.length) {
    errors.push(
      "No storefront-published, checkout-sellable product has complete launch data.",
    );
  }
  if (stockMismatches.length) {
    errors.push(
      `Product stock disagrees with warehouse stock for ${stockMismatches.length} active product(s).`,
    );
  }
  if (!payments.length) errors.push("No checkout payment method is enabled.");
  if (!warehouses.some((warehouse) => warehouse.isDefault)) {
    errors.push("No active default warehouse exists.");
  }

  const localMigrations = (
    await fs.readdir(path.resolve("prisma/migrations"), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const completedMigrations = new Set(
    migrationRows
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name),
  );
  const pendingMigrations = localMigrations.filter(
    (migration) => !completedMigrations.has(migration),
  );
  const failedMigrations = migrationRows.filter(
    (row) => !row.finished_at && !row.rolled_back_at,
  );
  if (pendingMigrations.length) {
    errors.push(`Pending database migrations: ${pendingMigrations.join(", ")}`);
  }
  if (failedMigrations.length) {
    errors.push(`Unresolved failed migrations: ${failedMigrations.length}.`);
  }
  if (rlsViolations.length) {
    errors.push(`RLS is disabled on ${rlsViolations.length} public table(s).`);
  }
  if (apiGrants.length) {
    errors.push(`anon/authenticated retain ${apiGrants.length} public-table grant(s).`);
  }

  const bucketById = new Map(
    storageBuckets.map((bucket) => [bucket.id, bucket.public]),
  );
  if (storageSchemaAvailable) {
    for (const id of [
      "fiscal-receipts",
      "order-receipts",
      "reclamation-uploads",
      "shipment-labels",
    ]) {
      if (!bucketById.has(id)) errors.push(`Private storage bucket is missing: ${id}.`);
      else if (bucketById.get(id) !== false) errors.push(`Sensitive storage bucket is public: ${id}.`);
    }
    if (bucketById.get("product-media") !== true) {
      errors.push("Public product-media bucket is missing or private.");
    }
  }

  const failedEmails = countGroup(emailStatuses, "status", "FAILED");
  const failedShipments = countGroup(shipmentStatuses, "status", "FAILED");
  const failedFiscal = countGroup(fiscalStatuses, "status", "FAILED");
  const failedJobs = countGroup(backgroundStatuses, "status", "FAILED");
  const queuedJobs = countGroup(backgroundStatuses, "status", "QUEUED");
  if (failedEmails) warnings.push(`${failedEmails} historical email message(s) are FAILED.`);
  if (failedShipments) warnings.push(`${failedShipments} historical shipment(s) are FAILED.`);
  if (failedFiscal) warnings.push(`${failedFiscal} historical fiscal document(s) are FAILED.`);
  if (failedJobs) warnings.push(`${failedJobs} background job(s) are FAILED.`);
  if (queuedJobs) warnings.push(`${queuedJobs} background job(s) are QUEUED.`);

  const report = {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    catalog: {
      active: catalog.length,
      ready: ready.length,
      published: published.length,
      checkoutSellable: checkoutSellable.length,
      purchasableCount: purchasable.length,
      purchasableBySource: countValues(purchasable, "source"),
      purchasableCanaries: purchasable.slice(0, 10).map((product) => ({
        sku: product.sku,
        sellableStock: product.sellableStock,
        source: product.source,
      })),
      incompleteByReason: reasonCounts,
      unpublishedByReason: countReasons(catalog, "publicationBlockers"),
      stockMismatchCount: stockMismatches.length,
    },
    checkout: {
      enabledPaymentMethods: payments.map((item) => item.method),
      activeWarehouses: warehouses.length,
      hasDefaultWarehouse: warehouses.some((warehouse) => warehouse.isDefault),
    },
    policy: {
      rabaluxEnabled: enabledEnv("RABALUX_ENABLED"),
      webAutoAvailabilityEnforced: enabledEnv("ENFORCE_WEB_AUTO_AVAILABILITY"),
      rabaluxStockMaxAgeMinutes: RABALUX_STOCK_MAX_AGE_MS / 60_000,
      rabaluxSafetyStock: RABALUX_SUPPLIER_SAFETY_STOCK,
    },
    database: {
      localMigrations: localMigrations.length,
      completedMigrations: completedMigrations.size,
      pendingMigrations,
      failedMigrations: failedMigrations.length,
      publicTablesWithoutRls: rlsViolations.length,
      anonAuthenticatedGrants: apiGrants.length,
    },
    storage: {
      schemaAvailable: storageSchemaAvailable,
      buckets: Object.fromEntries(bucketById),
    },
    operations: {
      email: groupCounts(emailStatuses, ["status"]),
      shipments: groupCounts(shipmentStatuses, ["provider", "status"]),
      fiscal: groupCounts(fiscalStatuses, ["status"]),
      backgroundJobs: groupCounts(backgroundStatuses, ["status"]),
    },
    warnings,
    errors,
  };

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function groupCounts(rows, keys) {
  return Object.fromEntries(
    rows.map((row) => [
      keys.map((key) => row[key] ?? "unknown").join(":"),
      row._count._all,
    ]),
  );
}

function countGroup(rows, key, value) {
  return rows
    .filter((row) => row[key] === value)
    .reduce((sum, row) => sum + row._count._all, 0);
}

function countReasons(rows, key) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row[key]) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

function countValues(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? "UNKNOWN";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function checkoutAvailability(product, now) {
  if (product.supplier?.integrationKey !== RABALUX_INTEGRATION_KEY) {
    const sellableStock = nonnegativeInt(product.stock);
    return {
      sellableStock,
      source: sellableStock > 0 ? "DC" : "NONE",
      publicationEligible: true,
    };
  }

  const warehouseStock = nonnegativeInt(product.dcAvailableQty);
  const supplierStock = nonnegativeInt(product.supplierStock ?? 0);
  const reservedStock = nonnegativeInt(product.supplierReservedStock ?? 0);
  const supplierFresh = isFreshSupplierStock(product.lastSupplierStockSyncAt, now);
  const supplierEligible =
    enabledEnv("RABALUX_ENABLED") &&
    product.supplier.enabled &&
    product.supplierApprovalStatus === "APPROVED" &&
    supplierStock >= RABALUX_PUBLIC_STOCK_THRESHOLD &&
    supplierFresh;
  const supplierAvailable = supplierEligible
    ? Math.max(
        supplierStock - reservedStock - RABALUX_SUPPLIER_SAFETY_STOCK,
        0,
      )
    : 0;
  const sellableStock = warehouseStock + supplierAvailable;
  const source =
    warehouseStock > 0 && supplierAvailable > 0
      ? "MIXED"
      : warehouseStock > 0
        ? "DC"
        : supplierAvailable > 0
          ? "SUPPLIER"
          : "NONE";

  return {
    sellableStock,
    source,
    publicationEligible: warehouseStock > 0 || supplierEligible,
  };
}

function isFreshSupplierStock(value, now) {
  if (!value) return false;
  const timestamp = value instanceof Date ? value : new Date(value);
  const age = now.getTime() - timestamp.getTime();
  return Number.isFinite(age) && age >= -5 * 60 * 1_000 && age <= RABALUX_STOCK_MAX_AGE_MS;
}

function enabledEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("GET_FROM_")) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function nonnegativeInt(value) {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}

function getConnectionString() {
  const value = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((candidate) => candidate?.trim());
  if (!value) throw new Error("A database connection string is required.");
  const url = new URL(value);
  if (url.port === "6543") {
    throw new Error("Runtime readiness requires the session-mode port 5432 database URL.");
  }
  return value;
}

function withDatabaseSsl(value) {
  const url = new URL(value);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return value;
  const sslMode = process.env.DATABASE_SSLMODE?.trim() || url.searchParams.get("sslmode") || "require";
  url.searchParams.set("sslmode", sslMode);
  if (["prefer", "require", "verify-ca"].includes(sslMode.toLowerCase())) {
    url.searchParams.set("uselibpqcompat", "true");
  }
  return url.toString();
}

function isLocalDatabase(value) {
  return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
}

function isMissingStorageSchemaError(error) {
  const details = [
    error?.code,
    error?.message,
    error?.meta?.code,
    error?.meta?.message,
    error?.cause?.code,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
  return details.includes("42P01") && details.includes("storage.buckets");
}
