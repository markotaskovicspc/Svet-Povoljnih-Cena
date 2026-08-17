import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: process.env.ENV_FILE || ".env.local", quiet: true });
loadEnv({ quiet: true });

function configured(value) {
  const trimmed = value?.trim();
  return trimmed && !/^GET_FROM_/i.test(trimmed) ? trimmed : null;
}

function withSslNoVerify(connectionString) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return connectionString;
  }
}

function shares(values, fallback) {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  const source = total > 0 ? values : fallback;
  const sourceTotal = source.reduce((sum, value) => sum + Math.max(value, 0), 0);
  return source.map((value) =>
    sourceTotal > 0 ? Math.max(value, 0) / sourceTotal : 1 / source.length,
  );
}

function allocate(totalRsd, allocationShares) {
  const totalCents = Math.round(totalRsd * 100);
  const shareTotal = allocationShares.reduce(
    (sum, value) => sum + Math.max(value, 0),
    0,
  );
  let assigned = 0;
  return allocationShares.map((value, index) => {
    const cents =
      index === allocationShares.length - 1
        ? totalCents - assigned
        : Math.round(
            totalCents *
              (shareTotal > 0
                ? Math.max(value, 0) / shareTotal
                : 1 / allocationShares.length),
          );
    assigned += cents;
    return cents / 100;
  });
}

function otherShares(basis, values, volumes, weights) {
  const valueShares = shares(values, values);
  if (basis === "VOLUME") return shares(volumes, values);
  if (basis === "WEIGHT") return shares(weights, values);
  if (basis === "AUTO_UTILIZATION") {
    const volumeShares = shares(volumes, values);
    const weightShares = shares(weights, values);
    return values.map((_, index) =>
      Math.max(volumeShares[index] || 0, weightShares[index] || 0),
    );
  }
  return valueShares;
}

function bmPct(grossPrice, cogs) {
  if (
    !Number.isFinite(grossPrice) ||
    !Number.isFinite(cogs) ||
    !(grossPrice > 0) ||
    !(cogs >= 0)
  ) {
    return null;
  }
  const net = grossPrice / 1.2;
  return Math.round((((net - cogs) / net) * 100 + Number.EPSILON) * 100) / 100;
}

const connectionString =
  configured(process.env.POSTGRES_URL_NON_POOLING) ||
  configured(process.env.DATABASE_URL) ||
  configured(process.env.POSTGRES_PRISMA_URL) ||
  configured(process.env.POSTGRES_URL);
if (!connectionString) {
  throw new Error("Nedostaje stvarni DATABASE_URL ili POSTGRES_URL_NON_POOLING.");
}

const db = new PrismaClient({
  adapter: new PrismaPg(withSslNoVerify(connectionString)),
});

try {
  const now = new Date();
  const [products, invoices, bookedOrders] = await Promise.all([
    db.product.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        sku: true,
        cogs: true,
        stock: true,
        warehouseStocks: { select: { qty: true } },
        fullPrice: true,
        priceListEntries: {
          where: {
            priceList: { kind: "RETAIL", active: true },
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
          select: { price: true, validFrom: true },
          orderBy: { validFrom: "desc" },
          take: 1,
        },
      },
      orderBy: { sku: "asc" },
    }),
    db.inboundInvoice.findMany({
      where: {
        status: "POSTED",
        purchaseOrderId: { not: null },
        invoiceValueRsd: { not: null },
        customsValueRsd: { not: null },
        transportValueRsd: { not: null },
        otherRelatedCostsRsd: { not: null },
      },
      select: {
        id: true,
        number: true,
        netValue: true,
        invoiceValueRsd: true,
        customsValueRsd: true,
        transportValueRsd: true,
        otherRelatedCostsRsd: true,
        allocationBasis: true,
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            exchangeRate: true,
            items: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                sku: true,
                qty: true,
                purchasePrice: true,
                customsRate: true,
                freightAllocated: true,
                additionalCostAllocated: true,
                totalVolume: true,
                totalWeight: true,
              },
            },
          },
        },
      },
      orderBy: { invoiceDate: "asc" },
    }),
    db.purchaseOrder.findMany({
      where: { cogsBookedAt: { not: null } },
      select: { id: true, number: true, cogsBookingSnapshot: true },
    }),
  ]);

  const invalidCogs = products
    .filter((product) => {
      const cogs = product.cogs == null ? null : Number(product.cogs);
      return cogs == null || !Number.isFinite(cogs) || cogs < 0;
    })
    .map((product) => product.sku);
  const stockedProducts = products.filter(
    (product) =>
      product.stock > 0 ||
      product.warehouseStocks.some((warehouseStock) => warehouseStock.qty > 0),
  );
  const stockedInvalidCogs = stockedProducts
    .filter((product) => {
      const cogs = product.cogs == null ? null : Number(product.cogs);
      return cogs == null || !Number.isFinite(cogs) || cogs < 0;
    })
    .map((product) => product.sku);
  const retailBm = products.map((product) => {
    const price = Number(product.priceListEntries[0]?.price ?? product.fullPrice);
    const cogs = product.cogs == null ? null : Number(product.cogs);
    return { sku: product.sku, price, cogs, bmPct: bmPct(price, cogs) };
  });

  const reallocationDifferences = [];
  const invoiceReconciliationErrors = [];
  for (const invoice of invoices) {
    const order = invoice.purchaseOrder;
    if (!order?.items.length) continue;
    const values = order.items.map(
      (item) => Number(item.purchasePrice) * Number(order.exchangeRate) * item.qty,
    );
    const customs = order.items.map(
      (item, index) => values[index] * (Number(item.customsRate ?? 0) / 100),
    );
    const volumes = order.items.map((item) => Number(item.totalVolume ?? 0));
    const weights = order.items.map((item) => Number(item.totalWeight ?? 0));
    const invoiceAllocated = allocate(
      Number(invoice.invoiceValueRsd),
      shares(values, values),
    );
    const customsAllocated = allocate(
      Number(invoice.customsValueRsd),
      shares(customs, values),
    );
    const transportAllocated = allocate(
      Number(invoice.transportValueRsd),
      shares(volumes, values),
    );
    const otherAllocated = allocate(
      Number(invoice.otherRelatedCostsRsd),
      otherShares(invoice.allocationBasis, values, volumes, weights),
    );
    const componentTotal =
      Number(invoice.invoiceValueRsd) +
      Number(invoice.customsValueRsd) +
      Number(invoice.transportValueRsd) +
      Number(invoice.otherRelatedCostsRsd);
    if (Math.abs(componentTotal - Number(invoice.netValue)) > 0.01) {
      invoiceReconciliationErrors.push({
        invoice: invoice.number,
        storedNetRsd: Number(invoice.netValue),
        componentTotalRsd: componentTotal,
      });
    }
    order.items.forEach((item, index) => {
      const actual =
        invoiceAllocated[index] +
        customsAllocated[index] +
        transportAllocated[index] +
        otherAllocated[index];
      const baseline =
        values[index] +
        customs[index] +
        Number(item.freightAllocated ?? 0);
      const expectedAdjustment = Math.round((actual - baseline) * 100) / 100;
      const storedAdjustment = Number(item.additionalCostAllocated ?? 0);
      if (Math.abs(expectedAdjustment - storedAdjustment) > 0.01) {
        reallocationDifferences.push({
          invoice: invoice.number,
          purchaseOrder: order.number,
          sku: item.sku,
          storedAdjustmentRsd: storedAdjustment,
          expectedAdjustmentRsd: expectedAdjustment,
          differenceRsd:
            Math.round((expectedAdjustment - storedAdjustment) * 100) / 100,
        });
      }
    });
  }

  const invalidSnapshots = bookedOrders
    .filter((order) => {
      const snapshot = order.cogsBookingSnapshot;
      return !(
        snapshot &&
        typeof snapshot === "object" &&
        !Array.isArray(snapshot) &&
        snapshot.version === 1 &&
        Array.isArray(snapshot.products)
      );
    })
    .map((order) => order.number);

  const fullOutput = process.argv.includes("--full");
  console.log(
    JSON.stringify(
      {
        mode: "READ_ONLY_DRY_RUN",
        generatedAt: new Date().toISOString(),
        summary: {
          activeProducts: products.length,
          activeCatalogProductsWithoutBookedCogs: invalidCogs.length,
          stockedProducts: stockedProducts.length,
          stockedProductsWithInvalidOrMissingCogs: stockedInvalidCogs.length,
          productsWithCalculatedRetailBm: retailBm.filter(
            (row) => row.bmPct != null,
          ).length,
          postedInvoicesChecked: invoices.length,
          invoiceReconciliationErrors: invoiceReconciliationErrors.length,
          historicalLineAllocationsThatWouldChange:
            reallocationDifferences.length,
          invalidOrMissingCogsSnapshots: invalidSnapshots.length,
        },
        stockedInvalidCogs,
        invoiceReconciliationErrors,
        invalidSnapshots,
        reallocationDifferences,
        retailBm: retailBm.filter((row) => fullOutput || row.bmPct != null),
        ...(fullOutput ? { invalidCogs } : {}),
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
