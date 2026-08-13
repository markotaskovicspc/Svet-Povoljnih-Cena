import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: "/Users/luka/svet povoljnih cena/.env.local", quiet: true });

const raw =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;
if (!raw) throw new Error("Database URL is not configured.");
const url = new URL(raw);
url.searchParams.set("sslmode", "no-verify");
url.searchParams.delete("uselibpqcompat");

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
  }),
});

const sanitize = (value) =>
  value
    ? String(value)
        .replace(/https?:\/\/\S+/gi, "<url>")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
        .replace(/\b\d{5,}\b/g, "<number>")
        .slice(0, 180)
    : null;
const grouped = (rows, keys) =>
  Object.fromEntries(
    rows.map((row) => [
      keys.map((key) => row[key] ?? "null").join(":"),
      row._count._all,
    ]),
  );

try {
  const report = { checkedAt: new Date().toISOString() };

  report.adminRoles = grouped(
    await db.adminUser.groupBy({ by: ["role", "enabled"], _count: { _all: true } }),
    ["role", "enabled"],
  );
  report.qaAdminAccounts = await db.adminUser.groupBy({
    by: ["role", "enabled"],
    where: { email: { endsWith: ".local" } },
    _count: { _all: true },
  });

  report.integrations = (await db.integrationHealth.findMany({ orderBy: { provider: "asc" } })).map(
    (row) => ({
      provider: row.provider,
      status: row.status,
      missingKeyCount: row.missingKeys.length,
      message: sanitize(row.message),
      checkedAt: row.checkedAt,
      updatedAt: row.updatedAt,
    }),
  );

  report.orders = {
    grouped: grouped(
      await db.order.groupBy({
        by: ["channel", "status", "paymentMethod"],
        _count: { _all: true },
      }),
      ["channel", "status", "paymentMethod"],
    ),
    total: await db.order.count(),
    lastCreatedAt: (await db.order.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }))?.createdAt ?? null,
  };
  report.checkoutSessions = grouped(
    await db.checkoutSession.groupBy({ by: ["status", "step"], _count: { _all: true } }),
    ["status", "step"],
  );
  report.payments = grouped(
    await db.payment.groupBy({
      by: ["provider", "method", "status", "currency"],
      _count: { _all: true },
    }),
    ["provider", "method", "status", "currency"],
  );
  report.refunds = grouped(
    await db.paymentRefund.groupBy({
      by: ["provider", "method", "status", "currency"],
      _count: { _all: true },
    }),
    ["provider", "method", "status", "currency"],
  );
  report.shipments = grouped(
    await db.shipment.groupBy({ by: ["provider", "purpose", "status"], _count: { _all: true } }),
    ["provider", "purpose", "status"],
  );
  report.fiscal = grouped(
    await db.fiscalDocument.groupBy({ by: ["kind", "status", "source"], _count: { _all: true } }),
    ["kind", "status", "source"],
  );
  report.email = grouped(
    await db.emailMessage.groupBy({ by: ["provider", "kind", "status"], _count: { _all: true } }),
    ["provider", "kind", "status"],
  );
  report.backgroundJobs = grouped(
    await db.backgroundJob.groupBy({ by: ["kind", "status"], _count: { _all: true } }),
    ["kind", "status"],
  );

  report.oldestActionableJobs = (await db.backgroundJob.findMany({
    where: { status: { in: ["QUEUED", "RETRY", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      kind: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      availableAt: true,
      lockedAt: true,
      createdAt: true,
      updatedAt: true,
      lastError: true,
    },
  })).map((row) => ({ ...row, lastError: sanitize(row.lastError) }));

  report.recentOperationalFailures = {
    emails: (await db.emailMessage.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { provider: true, kind: true, status: true, error: true, createdAt: true, updatedAt: true },
    })).map((row) => ({ ...row, error: sanitize(row.error) })),
    shipments: (await db.shipment.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { provider: true, purpose: true, status: true, syncError: true, createdAt: true, updatedAt: true },
    })).map((row) => ({ ...row, syncError: sanitize(row.syncError) })),
    fiscal: (await db.fiscalDocument.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { kind: true, source: true, status: true, attemptCount: true, error: true, createdAt: true, updatedAt: true },
    })).map((row) => ({ ...row, error: sanitize(row.error) })),
  };

  report.courierSyncRuns = (await db.courierSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 25,
    select: {
      provider: true,
      kind: true,
      status: true,
      recordsRead: true,
      recordsOk: true,
      recordsFail: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  })).map((row) => ({ ...row, errorMessage: sanitize(row.errorMessage) }));
  report.xExpressWebhooks = {
    total: await db.xExpressWebhookEvent.count(),
    unprocessed: await db.xExpressWebhookEvent.count({ where: { processedAt: null } }),
    failed: await db.xExpressWebhookEvent.count({ where: { processError: { not: null } } }),
    lastReceivedAt: (await db.xExpressWebhookEvent.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }))?.createdAt ?? null,
  };
  report.supplierImports = (await db.importRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
    select: {
      kind: true,
      dryRun: true,
      status: true,
      recordsRead: true,
      recordsOk: true,
      recordsFail: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      supplier: { select: { integrationKey: true } },
    },
  })).map((row) => ({ ...row, errorMessage: sanitize(row.errorMessage) }));
  report.stockSnapshots = await db.$queryRawUnsafe(`
    SELECT s."integrationKey" AS provider,
           COUNT(ss.id)::int AS snapshots,
           MAX(ss."capturedAt") AS latest,
           COUNT(*) FILTER (WHERE ss."capturedAt" >= NOW() - INTERVAL '30 minutes')::int AS fresh_30m
      FROM "Supplier" s
      LEFT JOIN "SupplierStockSnapshot" ss ON ss."supplierId" = s.id
     WHERE s."integrationKey" IS NOT NULL
     GROUP BY s."integrationKey"
     ORDER BY s."integrationKey"
  `);
  report.stockObservations = await db.$queryRawUnsafe(`
    SELECT s."integrationKey" AS provider,
           COUNT(p.id)::int AS items,
           MAX(p."lastSupplierStockSyncAt") AS latest,
           COUNT(p.id) FILTER (
             WHERE p."lastSupplierStockSyncAt" >= NOW() - INTERVAL '30 minutes'
           )::int AS fresh_30m,
           COUNT(p.id) FILTER (
             WHERE p."isActive" = true
               AND p."deletedAt" IS NULL
               AND p."availableWebManual" = true
               AND p."supplierApprovalStatus" = 'APPROVED'
               AND p."supplierStock" > 10
               AND p."lastSupplierStockSyncAt" >= NOW() - INTERVAL '30 minutes'
           )::int AS eligible_fresh_30m
      FROM "Supplier" s
      LEFT JOIN "Product" p ON p."supplierId" = s.id
     WHERE s."integrationKey" IS NOT NULL
     GROUP BY s."integrationKey"
     ORDER BY s."integrationKey"
  `);

  report.financialIntegrity = {
    orderFormulaMismatches: Number((await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
        FROM "Order"
       WHERE ABS("total" - (
         "subtotal" + "shipping" + "assemblyTotal"
         - COALESCE("voucherDiscount", 0)
         - COALESCE("firstPurchaseDiscount", 0)
         - COALESCE("savedCardDiscount", 0)
       )) > 0.005
    `))[0]?.count ?? 0),
    paymentOrderTotalMismatches: Number((await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
        FROM "Payment" p
        JOIN "Order" o ON o.id = p."orderId"
       WHERE p.status IN ('PAID','AUTHORIZED')
         AND ABS(p.amount - o.total) > 0.005
    `))[0]?.count ?? 0),
    invoiceOrderTotalMismatches: Number((await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
        FROM "Invoice" i
        JOIN "Order" o ON o.id = i."orderId"
       WHERE i.status <> 'CANCELLED'
         AND ABS(i.total - o.total) > 0.005
    `))[0]?.count ?? 0),
    fiscalGrossOrderTotalMismatches: Number((await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
        FROM "FiscalDocument" f
        JOIN "Order" o ON o.id = f."orderId"
       WHERE f.kind = 'SALE' AND f.status = 'ISSUED'
         AND ABS(f."totalGross" - o.total) > 0.005
    `))[0]?.count ?? 0),
    duplicatePaymentProviderRefs: Number((await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM (
        SELECT "providerRef" FROM "Payment"
         WHERE "providerRef" IS NOT NULL
         GROUP BY "providerRef" HAVING COUNT(*) > 1
      ) duplicates
    `))[0]?.count ?? 0),
    duplicateShipmentTrackingNumbers: Number((await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM (
        SELECT "trackingNo" FROM "Shipment"
         WHERE "trackingNo" IS NOT NULL
         GROUP BY "trackingNo" HAVING COUNT(*) > 1
      ) duplicates
    `))[0]?.count ?? 0),
  };
  report.financialMismatchDetails = await db.$queryRawUnsafe(`
    SELECT number, status, "paymentMethod", subtotal, savings, shipping,
           "assemblyTotal", "voucherDiscount", "firstPurchaseDiscount",
           "savedCardDiscount", total, "createdAt",
           (subtotal + shipping + "assemblyTotal"
             - COALESCE("voucherDiscount", 0)
             - COALESCE("firstPurchaseDiscount", 0)
             - COALESCE("savedCardDiscount", 0)) AS expected_total,
           (total - (subtotal + shipping + "assemblyTotal"
             - COALESCE("voucherDiscount", 0)
             - COALESCE("firstPurchaseDiscount", 0)
             - COALESCE("savedCardDiscount", 0))) AS difference
      FROM "Order"
     WHERE ABS(total - (subtotal + shipping + "assemblyTotal"
       - COALESCE("voucherDiscount", 0)
       - COALESCE("firstPurchaseDiscount", 0)
       - COALESCE("savedCardDiscount", 0))) > 0.005
     ORDER BY "createdAt" DESC
  `);

  const output = JSON.stringify(report, (_key, value) =>
    typeof value === "bigint" ? Number(value) : value, 2);
  if (process.argv.includes("--write")) {
    await fs.writeFile(new URL("./db-readonly-audit.json", import.meta.url), `${output}\n`);
  }
  console.log(output);
} finally {
  await db.$disconnect();
}
