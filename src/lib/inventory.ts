import "server-only";

import { Prisma, StockMovementKind } from "@prisma/client";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";

const DEFAULT_WAREHOUSE_CODE = "DC";
const DEFAULT_WAREHOUSE_NAME = "Distributivni centar";

export class InsufficientInventoryError extends Error {
  constructor(public readonly sku: string) {
    super(`Nema dovoljno zaliha za ${sku}.`);
    this.name = "InsufficientInventoryError";
  }
}

export async function ensureDefaultWarehouse(tx: Prisma.TransactionClient) {
  const existing = await tx.warehouse.findFirst({
    where: { active: true, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return tx.warehouse.upsert({
    where: { code: DEFAULT_WAREHOUSE_CODE },
    create: {
      code: DEFAULT_WAREHOUSE_CODE,
      name: DEFAULT_WAREHOUSE_NAME,
      active: true,
      isDefault: true,
    },
    update: { active: true, isDefault: true },
  });
}

type InventoryAdjustment = {
  idempotencyKey: string;
  productId: string;
  sku?: string;
  qtyDelta: number;
  warehouseId?: string;
  kind: StockMovementKind;
  note: string;
  actorId?: string | null;
  orderId?: string | null;
  orderItemId?: string | null;
  fiscalDocumentId?: string | null;
  dispatchNoteId?: string | null;
};

/**
 * Atomically updates warehouse stock, the storefront aggregate and the
 * immutable movement ledger. Existing Product.stock is used once as the
 * opening balance when a product has not yet been represented in WarehouseStock.
 */
export async function adjustInventory(
  tx: Prisma.TransactionClient,
  input: InventoryAdjustment,
) {
  if (!Number.isInteger(input.qtyDelta) || input.qtyDelta === 0) {
    throw new Error("Promena lagera mora biti ceo broj različit od nule.");
  }
  const existingMovement = await tx.stockMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingMovement) return existingMovement;
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${input.productId} FOR UPDATE`,
  );
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { sku: true, stock: true },
  });
  if (!product) throw new Error("Proizvod ne postoji.");
  const sku = input.sku ?? product.sku;
  const warehouse = input.warehouseId
    ? await tx.warehouse.findUnique({ where: { id: input.warehouseId } })
    : await ensureDefaultWarehouse(tx);
  if (!warehouse?.active) throw new Error("Aktivan magacin nije pronađen.");

  const representedWarehouseStock = await tx.warehouseStock.findFirst({
    where: { productId: input.productId },
    select: { id: true },
  });
  await tx.warehouseStock.upsert({
    where: {
      warehouseId_productId: {
        warehouseId: warehouse.id,
        productId: input.productId,
      },
    },
    create: {
      warehouseId: warehouse.id,
      productId: input.productId,
      // Product.stock predates per-warehouse rows and is only an opening
      // balance when this product has never been represented in any warehouse.
      qty: representedWarehouseStock ? 0 : product.stock,
    },
    update: {},
  });

  if (input.qtyDelta < 0) {
    const required = Math.abs(input.qtyDelta);
    const [warehouseUpdate, productUpdate] = await Promise.all([
      tx.warehouseStock.updateMany({
        where: {
          warehouseId: warehouse.id,
          productId: input.productId,
          qty: { gte: required },
        },
        data: { qty: { decrement: required } },
      }),
      tx.product.updateMany({
        where: { id: input.productId, stock: { gte: required } },
        data: { stock: { decrement: required } },
      }),
    ]);
    if (warehouseUpdate.count !== 1 || productUpdate.count !== 1) {
      throw new InsufficientInventoryError(sku);
    }
  } else {
    await Promise.all([
      tx.warehouseStock.update({
        where: {
          warehouseId_productId: {
            warehouseId: warehouse.id,
            productId: input.productId,
          },
        },
        data: { qty: { increment: input.qtyDelta } },
      }),
      tx.product.update({
        where: { id: input.productId },
        data: { stock: { increment: input.qtyDelta } },
      }),
    ]);
  }

  const [warehouseBalance, productBalance] = await Promise.all([
    tx.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId: input.productId,
        },
      },
      select: { qty: true },
    }),
    tx.product.findUnique({
      where: { id: input.productId },
      select: { stock: true },
    }),
  ]);
  await syncProductChannelAvailability(tx, input.productId);

  return tx.stockMovement.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      warehouseId: warehouse.id,
      productId: input.productId,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      fiscalDocumentId: input.fiscalDocumentId ?? null,
      dispatchNoteId: input.dispatchNoteId ?? null,
      kind: input.kind,
      sku,
      qty: input.qtyDelta,
      note: input.note,
      actorId: input.actorId ?? null,
      balanceAfterWarehouse: warehouseBalance?.qty ?? null,
      balanceAfterTotal: productBalance?.stock ?? null,
    },
  });
}

export async function setDefaultWarehouseStock(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    targetQty: number;
    actorId?: string | null;
    note: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isInteger(input.targetQty) || input.targetQty < 0) {
    throw new Error("Ciljna količina mora biti nenegativan ceo broj.");
  }
  const warehouse = await ensureDefaultWarehouse(tx);
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${input.productId} FOR UPDATE`,
  );
  const existingMovement = await tx.stockMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingMovement) return existingMovement;
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { sku: true, stock: true },
  });
  if (!product) throw new Error("Proizvod ne postoji.");
  const row = await tx.warehouseStock.upsert({
    where: {
      warehouseId_productId: {
        warehouseId: warehouse.id,
        productId: input.productId,
      },
    },
    create: {
      warehouseId: warehouse.id,
      productId: input.productId,
      qty: product.stock,
    },
    update: {},
  });
  const checkoutReservations = await tx.orderItem.aggregate({
    where: {
      productId: input.productId,
      warehouseReservedQty: { gt: 0 },
      OR: [{ warehouseId: warehouse.id }, { warehouseId: null }],
      order: {
        status: {
          notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"],
        },
      },
    },
    _sum: { warehouseReservedQty: true },
  });
  // WarehouseStock is decremented when checkout stock is reserved. The admin
  // "Stanje" field represents a physical count, so preserve active reservations
  // instead of adding them on top of the entered quantity.
  const currentPhysical =
    row.qty + (checkoutReservations._sum.warehouseReservedQty ?? 0);
  const delta = input.targetQty - currentPhysical;
  if (delta === 0) {
    // No inventory fact changed. Channel availability was synchronized by the
    // command that produced the current balances; re-reading every reservation
    // here only lengthens unrelated article edits and holds the product lock.
    return null;
  }
  const note = input.note.trim();
  if (note.length < 3) {
    throw new Error("Razlog ručne korekcije DC stanja je obavezan.");
  }

  let warehouseBalance: number;
  let productBalance: number;
  if (delta < 0) {
    const required = Math.abs(delta);
    const warehouseUpdate = await tx.warehouseStock.updateMany({
      where: {
        warehouseId: warehouse.id,
        productId: input.productId,
        qty: { gte: required },
      },
      data: { qty: { decrement: required } },
    });
    const productUpdate = await tx.product.updateMany({
      where: { id: input.productId, stock: { gte: required } },
      data: { stock: { decrement: required } },
    });
    if (warehouseUpdate.count !== 1 || productUpdate.count !== 1) {
      throw new InsufficientInventoryError(product.sku);
    }
    const updatedWarehouse = await tx.warehouseStock.findUniqueOrThrow({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId: input.productId,
        },
      },
      select: { qty: true },
    });
    const updatedProduct = await tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      select: { stock: true },
    });
    warehouseBalance = updatedWarehouse.qty;
    productBalance = updatedProduct.stock;
  } else {
    const updatedWarehouse = await tx.warehouseStock.update({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId: input.productId,
        },
      },
      data: { qty: { increment: delta } },
      select: { qty: true },
    });
    const updatedProduct = await tx.product.update({
      where: { id: input.productId },
      data: { stock: { increment: delta } },
      select: { stock: true },
    });
    warehouseBalance = updatedWarehouse.qty;
    productBalance = updatedProduct.stock;
  }

  await syncProductChannelAvailability(tx, input.productId);
  return tx.stockMovement.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      warehouseId: warehouse.id,
      productId: input.productId,
      kind: StockMovementKind.ADJUSTMENT,
      sku: product.sku,
      qty: delta,
      note,
      actorId: input.actorId ?? null,
      balanceAfterWarehouse: warehouseBalance,
      balanceAfterTotal: productBalance,
    },
  });
}
