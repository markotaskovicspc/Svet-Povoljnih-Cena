import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const apply = process.argv.includes("--apply");
const summaryOnly = process.argv.includes("--summary") || apply;
const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL;
if (!connectionString) throw new Error("Nedostaje DATABASE_URL.");

const db = new PrismaClient({
  adapter: new PrismaPg(withSslNoVerify(connectionString)),
});

try {
  const now = new Date();
  const liveWindow = {
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validTo: null }, { validTo: { gte: now } }] },
    ],
  };
  const [
    priceLists,
    products,
    incomingItems,
    groups,
    categories,
    legacySaleCount,
    attachments,
  ] =
    await Promise.all([
      db.priceList.findMany({
        where: { kind: "RETAIL", active: true, ...liveWindow },
        orderBy: [{ code: "asc" }, { validFrom: "desc" }],
      }),
      db.product.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          sku: true,
          fullPrice: true,
          incomingStock: true,
          isActive: true,
          availableWebManual: true,
          supplierApprovalStatus: true,
          newUntil: true,
          isNew: true,
          articleStatus: true,
          tncFrom: true,
          tncUntil: true,
          priceListEntries: {
            where: {
              price: { gt: 0 },
              validFrom: { lte: now },
              OR: [{ validTo: null }, { validTo: { gte: now } }],
              priceList: { kind: "RETAIL", active: true, ...liveWindow },
            },
            select: {
              id: true,
              price: true,
              validFrom: true,
              validTo: true,
              priceList: { select: { id: true, code: true, name: true } },
            },
            orderBy: { validFrom: "desc" },
          },
        },
      }),
      db.purchaseOrderItem.findMany({
        where: {
          productId: { not: null },
          purchaseOrder: {
            status: { notIn: ["RECEIVED", "CANCELLED"] },
            inboundInvoice: { is: { status: { in: ["RECEIVED", "POSTED"] } } },
          },
        },
        select: {
          productId: true,
          purchaseOrderId: true,
          qty: true,
          receivedQty: true,
        },
      }),
      db.group.findMany({
        orderBy: { name: "asc" },
        include: {
          _count: { select: { products: true, linearPromotions: true } },
          recommendationRules: {
            include: { _count: { select: { products: true } } },
          },
        },
      }),
      db.category.findMany({
        orderBy: [{ level: "asc" }, { order: "asc" }],
        select: {
          id: true,
          name: true,
          path: true,
          parentId: true,
          _count: { select: { products: true, children: true } },
        },
      }),
      db.product.count({ where: { deletedAt: null, salePrice: { not: null } } }),
      db.productAttachment.findMany({
        orderBy: [{ product: { sku: "asc" } }, { section: "asc" }, { order: "asc" }],
        select: {
          id: true,
          section: true,
          kind: true,
          origin: true,
          label: true,
          url: true,
          product: { select: { id: true, sku: true } },
        },
      }),
    ]);

  const selectedPriceList =
    priceLists.find((priceList) => priceList.code.toUpperCase() === "MP") ??
    priceLists[0] ??
    null;
  const missingRetailEntries = products.filter(
    (product) => product.priceListEntries.length === 0,
  );
  const backfillableRetailEntries = missingRetailEntries.filter(
    (product) => Number(product.fullPrice) > 0,
  );
  const invalidLegacyPrices = missingRetailEntries.filter(
    (product) => Number(product.fullPrice) <= 0,
  );
  const priceConflicts = products.filter(
    (product) => product.priceListEntries.length > 1,
  );
  const incomingByProduct = new Map(products.map((product) => [product.id, 0]));
  for (const item of incomingItems) {
    if (!item.productId) continue;
    incomingByProduct.set(
      item.productId,
      (incomingByProduct.get(item.productId) ?? 0) +
        Math.max(item.qty - item.receivedQty, 0),
    );
  }
  const incomingMismatches = products.filter(
    (product) => product.incomingStock !== (incomingByProduct.get(product.id) ?? 0),
  );
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const derivedNewnessMismatches = products.filter(
    (product) =>
      product.isNew !== Boolean(product.newUntil && product.newUntil >= today),
  );
  const tncStatusMismatches = products.filter(
    (product) =>
      product.articleStatus !== "DTZ" &&
      (product.tncFrom !== null || product.tncUntil !== null),
  );
  const emptyCategories = categories.filter(
    (category) => category._count.products === 0 && category._count.children === 0,
  );
  const removableGroups = groups.filter(
    (group) =>
      group._count.products === 0 &&
      group._count.linearPromotions === 0 &&
      group.recommendationRules.every((rule) => rule._count.products === 0),
  );

  console.log(`Article master audit (${apply ? "apply" : "dry-run"})`);
  console.log(`liveProducts=${products.length}`);
  console.log(`activeRetailPriceLists=${priceLists.length}`);
  console.log(`selectedRetailPriceList=${selectedPriceList?.code ?? "NONE"}`);
  console.log(`missingRetailEntries=${missingRetailEntries.length}`);
  console.log(`backfillableRetailEntries=${backfillableRetailEntries.length}`);
  console.log(`invalidLegacyPrices=${invalidLegacyPrices.length}`);
  console.log(`activeRetailPriceConflicts=${priceConflicts.length}`);
  console.log(`incomingStockMismatches=${incomingMismatches.length}`);
  console.log(`derivedNewnessMismatches=${derivedNewnessMismatches.length}`);
  console.log(`tncStatusMismatches=${tncStatusMismatches.length}`);
  console.log(`legacySalePrices=${legacySaleCount}`);
  console.log(`emptyLeafCategories=${emptyCategories.length}`);
  for (const category of emptyCategories) {
    console.log(`  category=${category.path} id=${category.id}`);
  }
  for (const product of priceConflicts) {
    console.log(
      `  priceConflict sku=${product.sku} entries=${product.priceListEntries
        .map((entry) => `${entry.priceList.code}:${entry.price}`)
        .join(",")}`,
    );
  }
  for (const product of invalidLegacyPrices) {
    console.log(
      `  invalidPrice sku=${product.sku} fullPrice=${product.fullPrice} active=${product.isActive} web=${product.availableWebManual} supplierApproval=${product.supplierApprovalStatus ?? "NONE"}`,
    );
  }
  console.log(`safeEmptyGroups=${removableGroups.length}`);
  for (const group of removableGroups) {
    console.log(
      `  group=${group.name} emptyRules=${group.recommendationRules.length}`,
    );
  }
  console.log(`attachments=${attachments.length}`);
  if (!summaryOnly) {
    for (const row of attachments) {
      console.log(
        `  attachment sku=${row.product.sku} id=${row.id} section=${row.section} kind=${row.kind} origin=${row.origin} label=${JSON.stringify(row.label)} url=${row.url}`,
      );
    }
  }

  if (!apply) {
    console.log("Dry-run završen. Dodajte --apply tek nakon pregleda izveštaja.");
    process.exit(0);
  }
  if (!selectedPriceList) {
    throw new Error("Nema aktivnog RETAIL cenovnika; migracija cena je zaustavljena.");
  }

  for (const batch of chunks(backfillableRetailEntries, 100)) {
    await db.priceListEntry.createMany({
      data: batch.map((product) => ({
        priceListId: selectedPriceList.id,
        productId: product.id,
        price: product.fullPrice,
        validFrom: now,
      })),
      skipDuplicates: true,
    });
  }

  for (const batch of chunks(incomingMismatches, 25)) {
    await Promise.all(
      batch.map((product) =>
        db.product.update({
          where: { id: product.id },
          data: { incomingStock: incomingByProduct.get(product.id) ?? 0 },
        }),
      ),
    );
  }

  for (const group of removableGroups) {
    await db.$transaction(async (tx) => {
      const fresh = await tx.group.findUnique({
        where: { id: group.id },
        include: {
          _count: { select: { products: true, linearPromotions: true } },
          recommendationRules: {
            include: { _count: { select: { products: true } } },
          },
        },
      });
      if (
        !fresh ||
        fresh._count.products > 0 ||
        fresh._count.linearPromotions > 0 ||
        fresh.recommendationRules.some((rule) => rule._count.products > 0)
      ) {
        throw new Error(`Grupa ${group.name} je dobila zavisnost; cleanup je zaustavljen.`);
      }
      await tx.recommendationRule.deleteMany({ where: { groupId: group.id } });
      await tx.group.delete({ where: { id: group.id } });
    });
  }

  console.log(
    `Primena završena: priceEntries=${backfillableRetailEntries.length}, incomingStock=${incomingMismatches.length}, groups=${removableGroups.length}.`,
  );
} finally {
  await db.$disconnect();
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function withSslNoVerify(value) {
  try {
    const url = new URL(value);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      url.searchParams.set("sslmode", "no-verify");
      url.searchParams.delete("uselibpqcompat");
    }
    return url.toString();
  } catch {
    return value;
  }
}
