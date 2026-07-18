import "server-only";

import { Prisma, StockMovementKind } from "@prisma/client";

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
      qty: product.stock,
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

  return tx.stockMovement.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      warehouseId: warehouse.id,
      productId: input.productId,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      fiscalDocumentId: input.fiscalDocumentId ?? null,
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
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { stock: true },
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
  const delta = input.targetQty - row.qty;
  if (delta === 0) return null;
  return adjustInventory(tx, {
    idempotencyKey: input.idempotencyKey,
    productId: input.productId,
    warehouseId: warehouse.id,
    qtyDelta: delta,
    kind: StockMovementKind.ADJUSTMENT,
    note: input.note,
    actorId: input.actorId,
  });
}
