import "server-only";

import {
  DispatchNoteType,
  DocumentPostingStatus,
  Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { reconcileWarehouseInventory } from "@/lib/inventory";
import {
  nextStocktakeDispatchNumber,
  stocktakeDeleteBlocker,
  STOCKTAKE_DESTINATION_NAME,
} from "@/lib/admin/stocktake-dispatch";

const MAX_CREATE_ATTEMPTS = 3;

async function defaultWarehouse() {
  return db.warehouse.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

function countedQty(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Prebrojana količina mora biti nenegativan ceo broj.");
  }
  return value;
}

async function requireDraftStocktake(
  tx: Prisma.TransactionClient,
  dispatchId: string,
) {
  const dispatch = await tx.dispatchNote.findUnique({
    where: { id: dispatchId },
    select: { id: true, number: true, type: true, status: true, archivedAt: true },
  });
  if (!dispatch || dispatch.type !== DispatchNoteType.STOCKTAKE) {
    throw new Error("Popis nije pronađen.");
  }
  if (dispatch.status !== DocumentPostingStatus.DRAFT) {
    throw new Error(`Popis ${dispatch.number} više nije moguće menjati.`);
  }
  if (dispatch.archivedAt) {
    throw new Error(`Popis ${dispatch.number} je arhiviran. Prvo ga vratite iz arhive.`);
  }
  return dispatch;
}

export async function archiveStocktakeDispatches(ids: string[]) {
  if (ids.length === 0) throw new Error("Izaberite bar jedan popis.");
  return (
    await db.dispatchNote.updateMany({
      where: {
        id: { in: Array.from(new Set(ids)) },
        type: DispatchNoteType.STOCKTAKE,
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    })
  ).count;
}

export async function restoreStocktakeDispatches(ids: string[]) {
  if (ids.length === 0) throw new Error("Izaberite bar jedan popis.");
  return (
    await db.dispatchNote.updateMany({
      where: {
        id: { in: Array.from(new Set(ids)) },
        type: DispatchNoteType.STOCKTAKE,
        archivedAt: { not: null },
      },
      data: { archivedAt: null },
    })
  ).count;
}

export async function deleteStocktakeDispatches(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) throw new Error("Izaberite bar jedan popis.");

  return db.$transaction(async (tx) => {
    const dispatches = await tx.dispatchNote.findMany({
      where: { id: { in: uniqueIds }, type: DispatchNoteType.STOCKTAKE },
      select: { id: true, number: true, status: true },
    });
    if (dispatches.length !== uniqueIds.length) {
      throw new Error("Jedan od izabranih popisa više ne postoji.");
    }
    for (const dispatch of dispatches) {
      const blocker = stocktakeDeleteBlocker(dispatch.number, dispatch.status);
      if (blocker) throw new Error(blocker);
    }

    const deleted = await tx.dispatchNote.deleteMany({
      where: {
        id: { in: dispatches.map((dispatch) => dispatch.id) },
        type: DispatchNoteType.STOCKTAKE,
        status: DocumentPostingStatus.DRAFT,
      },
    });
    if (deleted.count !== dispatches.length) {
      throw new Error("Popis je u međuvremenu promenjen i nije obrisan.");
    }
    return deleted.count;
  });
}

export async function createStocktakeDispatch() {
  const warehouse = await defaultWarehouse();
  if (!warehouse) throw new Error("Nema aktivnog izvornog magacina za novi popis.");

  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const existing = await db.dispatchNote.findMany({
      where: { number: { startsWith: `POP-${year}-` } },
      select: { number: true },
    });
    try {
      return await db.dispatchNote.create({
        data: {
          number: nextStocktakeDispatchNumber(
            existing.map((row) => row.number),
            year,
          ),
          type: DispatchNoteType.STOCKTAKE,
          sourceWarehouseId: warehouse.id,
          destinationName: STOCKTAKE_DESTINATION_NAME,
        },
      });
    } catch (error) {
      const isUniqueCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      if (!isUniqueCollision || attempt === MAX_CREATE_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error("Broj popisa nije moguće dodeliti.");
}

export async function saveStocktakeDispatchHeader(input: {
  id: string;
  sourceWarehouseId: string;
  notes: string | null;
}) {
  return db.$transaction(async (tx) => {
    await requireDraftStocktake(tx, input.id);
    const warehouse = await tx.warehouse.findUnique({
      where: { id: input.sourceWarehouseId },
      select: { id: true, active: true },
    });
    if (!warehouse?.active) throw new Error("Izabrani izvorni magacin nije aktivan.");
    return tx.dispatchNote.update({
      where: { id: input.id },
      data: {
        sourceWarehouseId: warehouse.id,
        destinationWarehouseId: null,
        destinationName: STOCKTAKE_DESTINATION_NAME,
        notes: input.notes,
      },
    });
  });
}

export async function addStocktakeDispatchItem(input: {
  dispatchId: string;
  sku: string;
  qty: number;
}) {
  const normalizedSku = input.sku.trim();
  if (!normalizedSku) throw new Error("Šifra artikla je obavezna.");
  const qty = countedQty(input.qty);

  return db.$transaction(async (tx) => {
    await requireDraftStocktake(tx, input.dispatchId);
    const product = await tx.product.findFirst({
      where: {
        sku: { equals: normalizedSku, mode: "insensitive" },
        isActive: true,
      },
      select: { id: true, sku: true, name: true, shortName: true },
    });
    if (!product) throw new Error(`Aktivan artikal ${normalizedSku} nije pronađen.`);
    const duplicate = await tx.dispatchNoteItem.findFirst({
      where: { dispatchNoteId: input.dispatchId, productId: product.id },
      select: { id: true },
    });
    if (duplicate) throw new Error(`Artikal ${product.sku} je već dodat u popis.`);
    return tx.dispatchNoteItem.create({
      data: {
        dispatchNoteId: input.dispatchId,
        productId: product.id,
        sku: product.sku,
        name: product.shortName ?? product.name,
        qty,
      },
    });
  });
}

export async function updateStocktakeDispatchItem(input: {
  dispatchId: string;
  itemId: string;
  qty: number;
}) {
  const qty = countedQty(input.qty);
  return db.$transaction(async (tx) => {
    await requireDraftStocktake(tx, input.dispatchId);
    const updated = await tx.dispatchNoteItem.updateMany({
      where: { id: input.itemId, dispatchNoteId: input.dispatchId },
      data: { qty },
    });
    if (updated.count !== 1) throw new Error("Stavka popisa nije pronađena.");
    return { id: input.itemId, qty };
  });
}

export async function removeStocktakeDispatchItem(input: {
  dispatchId: string;
  itemId: string;
}) {
  return db.$transaction(async (tx) => {
    await requireDraftStocktake(tx, input.dispatchId);
    const removed = await tx.dispatchNoteItem.deleteMany({
      where: { id: input.itemId, dispatchNoteId: input.dispatchId },
    });
    if (removed.count !== 1) throw new Error("Stavka popisa nije pronađena.");
    return { id: input.itemId };
  });
}

export async function postStocktakeDispatches(ids: string[], actorId: string) {
  if (ids.length === 0) throw new Error("Izaberite bar jedan popis.");
  let posted = 0;

  for (const id of ids) {
    const didPost = await db.$transaction(async (tx) => {
      const dispatch = await tx.dispatchNote.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!dispatch || dispatch.type !== DispatchNoteType.STOCKTAKE) {
        throw new Error(`Popis ${id} ne postoji.`);
      }
      if (dispatch.archivedAt) {
        throw new Error(`Popis ${dispatch.number} je arhiviran. Prvo ga vratite iz arhive.`);
      }
      if (dispatch.status !== DocumentPostingStatus.DRAFT) return false;
      if (dispatch.items.length === 0) {
        throw new Error(`Popis ${dispatch.number} nema nijednu stavku.`);
      }

      const locked = await tx.dispatchNote.updateMany({
        where: {
          id,
          type: DispatchNoteType.STOCKTAKE,
          status: DocumentPostingStatus.DRAFT,
          archivedAt: null,
        },
        data: {
          status: DocumentPostingStatus.POSTED,
          postedAt: new Date(),
          actorId,
          destinationWarehouseId: null,
          destinationName: STOCKTAKE_DESTINATION_NAME,
        },
      });
      if (locked.count !== 1) return false;

      for (const item of dispatch.items) {
        if (!item.productId) throw new Error(`Stavka ${item.sku} nema vezan artikal.`);
        const qty = countedQty(item.qty);
        await reconcileWarehouseInventory(tx, {
          idempotencyKey: `stocktake-dispatch:${dispatch.id}:${item.id}`,
          dispatchNoteId: dispatch.id,
          warehouseId: dispatch.sourceWarehouseId,
          productId: item.productId,
          sku: item.sku,
          countedQty: qty,
          note: `Popis ${dispatch.number}`,
          actorId,
        });
      }
      return true;
    });
    if (didPost) posted += 1;
  }

  return posted;
}
