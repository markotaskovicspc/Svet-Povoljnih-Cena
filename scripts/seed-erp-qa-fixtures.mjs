import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const connectionString = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
].find((value) => value?.trim());

if (process.env.ERP_QA_FIXTURES !== "1") {
  throw new Error("ERP QA fixtures require ERP_QA_FIXTURES=1.");
}
if (!connectionString) {
  throw new Error("ERP QA fixtures require a database connection string.");
}
if (!isLocalDatabase(connectionString)) {
  throw new Error("ERP QA fixtures can run only against a localhost database.");
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

try {
  const result = await db.$transaction(async (tx) => {
    const warehouse =
      (await tx.warehouse.findFirst({
        where: { active: true, isDefault: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await tx.warehouse.upsert({
        where: { code: "QA-DC" },
        update: { active: true, isDefault: true },
        create: {
          code: "QA-DC",
          name: "QA distributivni centar",
          active: true,
          isDefault: true,
        },
      }));

    const product = await tx.product.upsert({
      where: { sku: "QA-READINESS-001" },
      update: {
        slug: "qa-readiness-artikal",
        name: "QA artikal za runtime readiness",
        shortName: "QA readiness artikal",
        description: "Deterministički sintetički artikal; nikada nije produkcioni podatak.",
        fullPrice: 1999,
        widthCm: 40,
        depthCm: 30,
        heightCm: 20,
        stock: 5,
        dcAvailableQty: 5,
        isActive: true,
        deletedAt: null,
      },
      create: {
        sku: "QA-READINESS-001",
        slug: "qa-readiness-artikal",
        name: "QA artikal za runtime readiness",
        shortName: "QA readiness artikal",
        description: "Deterministički sintetički artikal; nikada nije produkcioni podatak.",
        fullPrice: 1999,
        widthCm: 40,
        depthCm: 30,
        heightCm: 20,
        stock: 5,
        dcAvailableQty: 5,
        isActive: true,
      },
    });

    await tx.productMedia.upsert({
      where: { id: "qa-readiness-product-media" },
      update: {
        productId: product.id,
        kind: "IMAGE",
        url: "/logo.jpeg",
        alt: "QA readiness artikal",
        order: 0,
      },
      create: {
        id: "qa-readiness-product-media",
        productId: product.id,
        kind: "IMAGE",
        url: "/logo.jpeg",
        alt: "QA readiness artikal",
        order: 0,
      },
    });

    await tx.warehouseStock.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId: product.id,
        },
      },
      update: { qty: 5 },
      create: {
        warehouseId: warehouse.id,
        productId: product.id,
        qty: 5,
      },
    });

    const retailPriceList = await tx.priceList.upsert({
      where: { code: "QA-RETAIL" },
      update: {
        name: "QA maloprodajni cenovnik",
        kind: "RETAIL",
        currency: "RSD",
        active: true,
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validTo: null,
      },
      create: {
        code: "QA-RETAIL",
        name: "QA maloprodajni cenovnik",
        kind: "RETAIL",
        currency: "RSD",
        active: true,
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
      },
    });

    const retailPriceValidFrom = new Date("2020-01-01T00:00:00.000Z");
    await tx.priceListEntry.upsert({
      where: {
        priceListId_productId_validFrom: {
          priceListId: retailPriceList.id,
          productId: product.id,
          validFrom: retailPriceValidFrom,
        },
      },
      update: { price: 1999, validTo: null },
      create: {
        priceListId: retailPriceList.id,
        productId: product.id,
        price: 1999,
        validFrom: retailPriceValidFrom,
      },
    });

    await tx.paymentMethodConfig.upsert({
      where: { method: "UPLATA_NA_RACUN" },
      update: {
        enabled: true,
        label: "Uplata na račun (QA)",
        note: "Deterministički localhost QA fixture.",
      },
      create: {
        method: "UPLATA_NA_RACUN",
        enabled: true,
        label: "Uplata na račun (QA)",
        note: "Deterministički localhost QA fixture.",
      },
    });

    return {
      productSku: product.sku,
      warehouseCode: warehouse.code,
      retailPriceList: retailPriceList.code,
    };
  });

  console.log(
    `ERP QA fixtures ready: ${result.productSku}, warehouse ${result.warehouseCode}, price list ${result.retailPriceList}, payment UPLATA_NA_RACUN.`,
  );
} finally {
  await db.$disconnect();
}

function isLocalDatabase(value) {
  return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
}
