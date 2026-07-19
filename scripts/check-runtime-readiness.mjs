import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const connectionString = getConnectionString();
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

try {
  const [
    products,
    payments,
    warehouses,
    emailStatuses,
    shipmentStatuses,
    fiscalStatuses,
    backgroundStatuses,
    migrationRows,
    rlsViolations,
    apiGrants,
    storageBuckets,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        sku: true,
        stock: true,
        fullPrice: true,
        salePrice: true,
        widthCm: true,
        depthCm: true,
        heightCm: true,
        deliveryDaysMin: true,
        deliveryDaysMax: true,
        media: { select: { id: true }, take: 1 },
        warehouseStocks: { select: { qty: true } },
      },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { enabled: true },
      select: { method: true },
    }),
    prisma.warehouse.findMany({
      where: { active: true },
      select: { code: true, isDefault: true },
    }),
    prisma.emailMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.shipment.groupBy({
      by: ["provider", "status"],
      _count: { _all: true },
    }),
    prisma.fiscalDocument.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.backgroundJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.$queryRawUnsafe(
      `SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations"`,
    ),
    prisma.$queryRawUnsafe(`
      SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND NOT c.relrowsecurity
       ORDER BY c.relname
    `),
    prisma.$queryRawUnsafe(`
      SELECT grantee, table_name, privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND grantee IN ('anon', 'authenticated')
       ORDER BY grantee, table_name, privilege_type
    `),
    prisma.$queryRawUnsafe(`
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
    `),
  ]);

  const catalog = products.map((product) => {
    const reasons = [];
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
    return {
      sku: product.sku,
      stock: product.stock,
      warehouseStock,
      ready: reasons.length === 0,
      reasons,
    };
  });
  const ready = catalog.filter((product) => product.ready);
  const purchasable = ready.filter((product) => product.stock > 0);
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
    errors.push("No active, ready, in-stock product can be purchased.");
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
      purchasable: purchasable.map((product) => ({
        sku: product.sku,
        stock: product.stock,
      })),
      incompleteByReason: reasonCounts,
      stockMismatchCount: stockMismatches.length,
    },
    checkout: {
      enabledPaymentMethods: payments.map((item) => item.method),
      activeWarehouses: warehouses.length,
      hasDefaultWarehouse: warehouses.some((warehouse) => warehouse.isDefault),
    },
    database: {
      localMigrations: localMigrations.length,
      completedMigrations: completedMigrations.size,
      pendingMigrations,
      failedMigrations: failedMigrations.length,
      publicTablesWithoutRls: rlsViolations.length,
      anonAuthenticatedGrants: apiGrants.length,
    },
    storage: Object.fromEntries(bucketById),
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

function getConnectionString() {
  const value = [
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.DATABASE_URL,
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
