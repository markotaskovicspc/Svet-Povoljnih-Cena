import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  composePurchasePriceAttributes,
  composePurchasePricePattern,
  normalizePurchasePriceSku,
  parsePurchasePriceDate,
  parsePurchasePriceValue,
  validatePurchasePricePeriod,
} from "@/lib/admin/purchase-price";
import { SUPPLIER_PARITY_OPTIONS } from "@/lib/supplier-master";

export type PurchasePriceCommandInput = Record<string, unknown>;

const articleSnapshotSelect = {
  id: true,
  sku: true,
  name: true,
  attribute1: true,
  attribute2: true,
  attribute3: true,
  attribute4: true,
  sizeLabel: true,
  colorPrimary: true,
  colorSecondary: true,
  supplier: {
    select: {
      id: true,
      name: true,
      currency: true,
      parity: true,
    },
  },
} satisfies Prisma.ProductSelect;

async function resolveArticleSnapshot(value: unknown) {
  const requestedSku = normalizePurchasePriceSku(value);
  const product = await db.product.findFirst({
    where: {
      sku: { equals: requestedSku, mode: "insensitive" },
      deletedAt: null,
    },
    select: articleSnapshotSelect,
  });
  if (!product) {
    throw new Error(`Artikal sa šifrom ${requestedSku} ne postoji u bazi artikala.`);
  }
  if (!product.supplier) {
    throw new Error(`Artikal ${product.sku} nema povezanog dobavljača.`);
  }
  const parity = product.supplier.parity?.trim();
  if (!parity) {
    throw new Error(
      `Dobavljač ${product.supplier.name} nema unet paritet u bazi dobavljača.`,
    );
  }
  if (
    !SUPPLIER_PARITY_OPTIONS.some((allowedParity) => allowedParity === parity)
  ) {
    throw new Error(
      `Dobavljač ${product.supplier.name} nema ispravan paritet u bazi dobavljača.`,
    );
  }

  return {
    productId: product.id,
    supplierId: product.supplier.id,
    sku: product.sku,
    name: product.name,
    attributes: composePurchasePriceAttributes(product),
    pattern: composePurchasePricePattern(product),
    currency: product.supplier.currency,
    parity,
  };
}

function nullableDate(value: unknown, label: string) {
  return value === null || value === undefined || value === ""
    ? null
    : parsePurchasePriceDate(value, label);
}

export async function createPurchasePrice(input: PurchasePriceCommandInput) {
  const price = parsePurchasePriceValue(input.purchasePrice);
  const validFrom = parsePurchasePriceDate(
    input.validFrom,
    "Važenje cene od",
  );
  const validTo = nullableDate(input.validTo, "Važenje cene do");
  validatePurchasePricePeriod(validFrom, validTo);
  const article = await resolveArticleSnapshot(input.sku);

  return db.purchasePrice.create({
    data: {
      ...article,
      price,
      validFrom,
      validTo,
    },
  });
}

export async function updatePurchasePriceCell(
  rowId: string,
  columnKey: string,
  value: unknown,
) {
  if (columnKey === "sku") {
    const article = await resolveArticleSnapshot(value);
    await db.purchasePrice.update({
      where: { id: rowId },
      data: article,
    });
    return { value: article.sku, refreshRow: true };
  }

  if (columnKey === "purchasePrice") {
    const price = parsePurchasePriceValue(value);
    await db.purchasePrice.update({
      where: { id: rowId },
      data: { price },
    });
    return { value: Number(price) };
  }

  if (columnKey === "validFrom" || columnKey === "validTo") {
    const current = await db.purchasePrice.findUnique({
      where: { id: rowId },
      select: { validFrom: true, validTo: true },
    });
    if (!current) throw new Error("Nabavna cena ne postoji.");

    const validFrom =
      columnKey === "validFrom"
        ? parsePurchasePriceDate(value, "Važenje cene od")
        : current.validFrom;
    const validTo =
      columnKey === "validTo"
        ? nullableDate(value, "Važenje cene do")
        : current.validTo;
    validatePurchasePricePeriod(validFrom, validTo);

    await db.purchasePrice.update({
      where: { id: rowId },
      data:
        columnKey === "validFrom"
          ? { validFrom }
          : { validTo },
    });
    return {
      value:
        columnKey === "validFrom"
          ? validFrom.toISOString().slice(0, 10)
          : validTo?.toISOString().slice(0, 10) ?? null,
    };
  }

  return null;
}
