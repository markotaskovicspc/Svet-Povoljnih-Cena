import "server-only";

import {
  CogsStatus,
  ErpCurrency,
  InboundInvoiceStatus,
  InboundInvoiceType,
  Prisma,
  PurchaseOrderStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertInboundInvoicePurchaseOrderLocked,
  allocateInvoiceCostsByOrderValue,
  calculateInboundInvoiceAmounts,
  calculateLinkedInvoiceAdjustmentRsd,
  calculatePurchaseOrderInvoiceDefaults,
  resolveInboundReceiptWarehouse,
  validateInboundInvoiceTotals,
  weightedAverageCogs,
} from "@/lib/admin/inbound-invoice";
import { recomputeIncomingStockForPurchaseOrders } from "@/lib/admin/incoming-stock.server";

export type SaveInboundInvoiceInput = {
  id: string;
  number: string;
  receiptDate: Date;
  purchaseOrderId: string;
  warehouseId: string;
  invoiceValueRsd: number;
  customsValueRsd: number;
  transportValueRsd: number;
  otherRelatedCostsRsd: number;
  notes: string | null;
};

function isPrismaUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function utcDateOnly(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

type CogsBookingSnapshot = {
  version: 1;
  products: Array<{
    productId: string;
    sku: string;
    stock: number;
    cogs: number | null;
  }>;
};

function readCogsBookingSnapshot(
  value: Prisma.JsonValue | null,
): CogsBookingSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, Prisma.JsonValue>;
  if (candidate.version !== 1 || !Array.isArray(candidate.products)) return null;
  const products: CogsBookingSnapshot["products"] = [];
  for (const raw of candidate.products) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const product = raw as Record<string, Prisma.JsonValue>;
    if (
      typeof product.productId !== "string" ||
      typeof product.sku !== "string" ||
      typeof product.stock !== "number" ||
      !Number.isInteger(product.stock) ||
      product.stock < 0 ||
      !(
        product.cogs === null ||
        (typeof product.cogs === "number" &&
          Number.isFinite(product.cogs) &&
          product.cogs >= 0)
      )
    ) {
      return null;
    }
    products.push({
      productId: product.productId,
      sku: product.sku,
      stock: product.stock,
      cogs: product.cogs,
    });
  }
  return { version: 1, products };
}

export async function createInboundInvoice(now = new Date()) {
  const year = now.getUTCFullYear();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await db.inboundInvoice.findMany({
      where: { number: { startsWith: `UF-${year}-` } },
      select: { number: true },
    });
    const next =
      existing.reduce((maximum, invoice) => {
        const match = invoice.number.match(new RegExp(`^UF-${year}-(\\d+)$`));
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0) + 1;
    try {
      return await db.inboundInvoice.create({
        data: {
          number: `UF-${year}-${String(next).padStart(4, "0")}`,
          type: InboundInvoiceType.COGS,
          status: InboundInvoiceStatus.DRAFT,
          invoiceDate: utcDateOnly(now),
          currency: ErpCurrency.RSD,
          exchangeRate: 1,
          allocationBasis: "VALUE",
        },
      });
    } catch (error) {
      if (!isPrismaUniqueError(error) || attempt === 5) throw error;
    }
  }
  throw new Error("Broj ulazne fakture nije mogao da bude dodeljen.");
}

export async function saveInboundInvoice(input: SaveInboundInvoiceInput) {
  const number = input.number.trim();
  if (!number) throw new Error("Broj fakture je obavezan.");
  if (!input.purchaseOrderId) throw new Error("Veza sa dokumentom je obavezna.");
  if (!input.warehouseId) throw new Error("Magacin prijema je obavezan.");
  const amounts = calculateInboundInvoiceAmounts({
    invoiceValueRsd: input.invoiceValueRsd,
    customsValueRsd: input.customsValueRsd,
    transportValueRsd: input.transportValueRsd,
    otherRelatedCostsRsd: input.otherRelatedCostsRsd,
  });
  validateInboundInvoiceTotals(amounts);

  const current = await db.inboundInvoice.findUnique({
    where: { id: input.id },
    select: { lockedAt: true, purchaseOrderId: true },
  });
  if (!current) throw new Error("Ulazna faktura ne postoji.");
  if (current.lockedAt) throw new Error("Proknjižena faktura se ne može menjati.");

  const [purchaseOrder, warehouse, linkedInvoice] = await Promise.all([
    db.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: {
        status: true,
        supplierId: true,
        supplier: { select: { enabled: true } },
      },
    }),
    db.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, active: true },
    }),
    db.inboundInvoice.findFirst({
      where: {
        purchaseOrderId: input.purchaseOrderId,
        id: { not: input.id },
      },
      select: { number: true },
    }),
  ]);
  if (!purchaseOrder || purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
    throw new Error("Izabrana porudžbenica nije dostupna.");
  }
  if (!purchaseOrder.supplierId || !purchaseOrder.supplier?.enabled) {
    throw new Error("Porudžbenica nema aktivnog dobavljača.");
  }
  if (!warehouse?.active) {
    throw new Error("Izaberite aktivan magacin prijema.");
  }
  if (linkedInvoice) {
    throw new Error(
      `Porudžbenica je već povezana sa ulaznom fakturom ${linkedInvoice.number}. Jedna porudžbenica može biti povezana samo sa jednom ulaznom fakturom.`,
    );
  }

  try {
    const updated = await db.inboundInvoice.updateMany({
      where: { id: input.id, lockedAt: null },
      data: {
        number,
        invoiceDate: utcDateOnly(input.receiptDate),
        supplierId: purchaseOrder.supplierId,
        purchaseOrderId: input.purchaseOrderId,
        warehouseId: warehouse.id,
        type: InboundInvoiceType.COGS,
        currency: ErpCurrency.RSD,
        exchangeRate: 1,
        value: amounts.netValue,
        invoiceValueRsd: amounts.invoiceValueRsd,
        customsValueRsd: amounts.customsValueRsd,
        transportValueRsd: amounts.transportValueRsd,
        otherRelatedCostsRsd: amounts.otherRelatedCostsRsd,
        netValue: amounts.netValue,
        vatValue: amounts.vatValue,
        grossValue: amounts.grossValue,
        allocationBasis: "VALUE",
        status: InboundInvoiceStatus.RECEIVED,
        cogsStatus: CogsStatus.PENDING,
        notes: input.notes,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Faktura je u međuvremenu proknjižena i nije izmenjena.");
    }
    await recomputeIncomingStockForPurchaseOrders(
      db,
      [current.purchaseOrderId, input.purchaseOrderId].filter(
        (value): value is string => Boolean(value),
      ),
    );
    return db.inboundInvoice.findUniqueOrThrow({ where: { id: input.id } });
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      const linkedInvoice = await db.inboundInvoice.findFirst({
        where: {
          purchaseOrderId: input.purchaseOrderId,
          id: { not: input.id },
        },
        select: { number: true },
      });
      if (linkedInvoice) {
        throw new Error(
          `Porudžbenica je u međuvremenu povezana sa ulaznom fakturom ${linkedInvoice.number}. Jedna porudžbenica može biti povezana samo sa jednom ulaznom fakturom.`,
        );
      }
      throw new Error(`Faktura sa brojem ${number} već postoji.`);
    }
    throw error;
  }
}

/**
 * Locks an invoice and rebuilds (rather than increments) the cost allocations
 * for every locked invoice linked to the same purchase order. This makes
 * retries idempotent and prevents the same invoice from increasing COGS twice.
 */
export async function lockInboundInvoice(id: string) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.inboundInvoice.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true } },
        purchaseOrder: {
          include: {
            items: {
              include: {
                product: {
                  select: { id: true, stock: true, cogs: true },
                },
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new Error("Ulazna faktura ne postoji.");
    if (!invoice.invoiceDate) throw new Error("Datum prijema je obavezan.");
    if (!invoice.supplier) throw new Error("Naziv dobavljača je obavezan.");
    if (!invoice.purchaseOrder) {
      throw new Error("Veza sa porudžbenicom je obavezna za COGS obračun.");
    }
    assertInboundInvoicePurchaseOrderLocked(invoice.purchaseOrder);
    if (!invoice.purchaseOrder.items.length) {
      throw new Error("Povezana porudžbenica nema artikle za COGS obračun.");
    }
    if (invoice.lockedAt) {
      await rebuildInboundInvoiceAllocations(tx, invoice.purchaseOrder.id);
      await recomputeIncomingStockForPurchaseOrders(tx, [invoice.purchaseOrder.id]);
      return tx.inboundInvoice.findUniqueOrThrow({ where: { id } });
    }
    validateInboundInvoiceTotals({
      netValue: Number(invoice.netValue),
      vatValue: Number(invoice.vatValue),
      grossValue: Number(invoice.grossValue),
    });
    if (Number(invoice.exchangeRate) <= 0) {
      throw new Error("Kurs mora biti veći od nule.");
    }

    const lockedAt = new Date();
    const claimed = await tx.inboundInvoice.updateMany({
      where: { id, lockedAt: null },
      data: {
        status: InboundInvoiceStatus.POSTED,
        cogsStatus: CogsStatus.LOCKED,
        lockedAt,
      },
    });
    if (claimed.count !== 1) {
      return tx.inboundInvoice.findUniqueOrThrow({ where: { id } });
    }

    await rebuildInboundInvoiceAllocations(tx, invoice.purchaseOrder.id);
    await recomputeIncomingStockForPurchaseOrders(tx, [invoice.purchaseOrder.id]);

    return tx.inboundInvoice.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * Completes the client-approved receiving workflow. The linked purchase order
 * is posted automatically, the invoice is posted, and the ordered quantities
 * are received into the warehouse selected on the invoice. Every step is
 * idempotent so a retry safely finishes an interrupted sequence.
 */
export async function postInboundInvoice(id: string, actorId: string) {
  const invoice = await db.inboundInvoice.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      purchaseOrderId: true,
      warehouseId: true,
      warehouse: { select: { id: true, name: true, active: true } },
      purchaseOrder: {
        select: {
          receivingWarehouse: {
            select: { id: true, name: true, active: true },
          },
        },
      },
    },
  });
  if (!invoice) throw new Error("Ulazna faktura ne postoji.");
  if (invoice.status === InboundInvoiceStatus.CANCELLED) {
    throw new Error("Stornirana faktura ne može da se proknjiži.");
  }
  if (!invoice.purchaseOrderId) {
    throw new Error("Veza sa porudžbenicom je obavezna.");
  }
  const warehouse = resolveInboundReceiptWarehouse({
    invoiceWarehouseId: invoice.warehouseId,
    invoiceWarehouse: invoice.warehouse,
    purchaseOrderWarehouse:
      invoice.purchaseOrder?.receivingWarehouse ?? null,
  });

  const {
    assertPurchaseOrderGoodsReceiptMasterReady,
    postPurchaseOrder,
    receivePurchaseOrder,
  } = await import(
    "@/lib/admin/po"
  );
  await assertPurchaseOrderGoodsReceiptMasterReady(invoice.purchaseOrderId);
  await db.$transaction([
    db.inboundInvoice.update({
      where: { id },
      data: { warehouseId: warehouse.id },
    }),
    db.purchaseOrder.update({
      where: { id: invoice.purchaseOrderId },
      data: { receivingWarehouseId: warehouse.id },
    }),
  ]);
  await postPurchaseOrder(invoice.purchaseOrderId, actorId);
  await lockInboundInvoice(id);
  const receipt = await receivePurchaseOrder(invoice.purchaseOrderId, actorId);
  return {
    invoiceId: id,
    purchaseOrderId: invoice.purchaseOrderId,
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    received: receipt.received,
    postedLines: receipt.postedLines,
  };
}

export async function cancelInboundInvoice(id: string) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.inboundInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, lockedAt: true, purchaseOrderId: true },
    });
    if (!invoice) throw new Error("Ulazna faktura ne postoji.");
    if (invoice.status === InboundInvoiceStatus.CANCELLED) return invoice;
    if (invoice.lockedAt || invoice.status === InboundInvoiceStatus.POSTED) {
      throw new Error(
        "Proknjižena faktura se ne može stornirati bez kontrolisanog storna robnog prijema.",
      );
    }

    await tx.inboundInvoice.update({
      where: { id },
      data: { status: InboundInvoiceStatus.CANCELLED, cogsStatus: CogsStatus.PENDING },
    });
    if (invoice.purchaseOrderId) {
      await rebuildInboundInvoiceAllocations(tx, invoice.purchaseOrderId);
      await recomputeIncomingStockForPurchaseOrders(tx, [invoice.purchaseOrderId]);
    }
    return tx.inboundInvoice.findUniqueOrThrow({ where: { id } });
  });
}

export async function rebuildInboundInvoiceAllocations(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
) {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      items: {
        include: {
          product: { select: { id: true, stock: true, cogs: true } },
        },
      },
      inboundInvoice: {
        select: {
          lockedAt: true,
          status: true,
          netValue: true,
          exchangeRate: true,
          invoiceValueRsd: true,
        },
      },
    },
  });
  if (!order) return;
  const defaults = calculatePurchaseOrderInvoiceDefaults({
    exchangeRate: Number(order.exchangeRate),
    freightCost: Number(order.freightCost),
    freightExchangeRate: Number(order.freightExchangeRate),
    lines: order.items.map((item) => ({
      qty: item.qty,
      purchasePrice: Number(item.purchasePrice),
      customsRatePct: Number(item.customsRate ?? 0),
    })),
  });
  const linkedCostRsd = calculateLinkedInvoiceAdjustmentRsd({
    purchaseOrderBaselineRsd:
      defaults.invoiceValueRsd +
      defaults.customsValueRsd +
      defaults.transportValueRsd,
    invoices:
      order.inboundInvoice?.lockedAt &&
      order.inboundInvoice.status === InboundInvoiceStatus.POSTED
        ? [
            {
              netValue: Number(order.inboundInvoice.netValue),
              exchangeRate: Number(order.inboundInvoice.exchangeRate),
              invoiceValueRsd:
                order.inboundInvoice.invoiceValueRsd == null
                  ? null
                  : Number(order.inboundInvoice.invoiceValueRsd),
            },
          ]
        : [],
  });
  const allocations = allocateInvoiceCostsByOrderValue(
    linkedCostRsd,
    order.items.map((item) => ({
      id: item.id,
      sku: item.sku,
      qty: item.qty,
      purchasePrice: Number(item.purchasePrice) * Number(order.exchangeRate),
    })),
  );
  const lateCostByProduct = new Map<
    string,
    { delta: number; stock: number; currentCogs: number }
  >();
  for (const item of order.items) {
    const previous = Number(item.additionalCostAllocated ?? 0);
    const next = allocations.get(item.id) ?? 0;
    await tx.purchaseOrderItem.update({
      where: { id: item.id },
      data: { additionalCostAllocated: next },
    });
    if (order.status === PurchaseOrderStatus.RECEIVED && item.product) {
      const current = lateCostByProduct.get(item.product.id) ?? {
        delta: 0,
        stock: item.product.stock,
        currentCogs: Number(item.product.cogs ?? 0),
      };
      current.delta += next - previous;
      lateCostByProduct.set(item.product.id, current);
    }
  }
  if (order.status === PurchaseOrderStatus.RECEIVED) {
    for (const [productId, cost] of lateCostByProduct) {
      if (cost.delta !== 0 && cost.stock > 0) {
        await tx.product.update({
          where: { id: productId },
          data: {
            cogs: Number((cost.currentCogs + cost.delta / cost.stock).toFixed(2)),
          },
        });
      }
    }
    return;
  }

  const hasPostedInvoice = Boolean(
    order.inboundInvoice?.lockedAt &&
      order.inboundInvoice.status === InboundInvoiceStatus.POSTED,
  );
  let snapshot = readCogsBookingSnapshot(order.cogsBookingSnapshot);
  if (order.cogsBookedAt && !snapshot) {
    throw new Error(
      `COGS snimak porudžbenice ${order.number} nije ispravan. Knjiženje je zaustavljeno da se nabavna cena ne bi obračunala dva puta.`,
    );
  }
  if (hasPostedInvoice) {
    if (!order.cogsBookedAt) {
      const products = new Map<
        string,
        CogsBookingSnapshot["products"][number]
      >();
      for (const item of order.items) {
        if (!item.product) continue;
        products.set(item.product.id, {
          productId: item.product.id,
          sku: item.sku,
          stock: item.product.stock,
          cogs:
            item.product.cogs == null ? null : Number(item.product.cogs),
        });
      }
      snapshot = { version: 1, products: Array.from(products.values()) };
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          cogsBookingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          cogsBookedAt: new Date(),
        },
      });
    }
    if (!snapshot) {
      throw new Error(
        "COGS snimak nije napravljen. Knjiženje je bezbedno zaustavljeno.",
      );
    }

    const snapshotByProduct = new Map(
      snapshot.products.map((product) => [product.productId, product]),
    );
    const incomingByProduct = new Map<
      string,
      { qty: number; totalCostRsd: number }
    >();
    for (const item of order.items) {
      if (!item.product || item.qty <= 0) continue;
      const purchaseRsd =
        Number(item.purchasePrice) * Number(order.exchangeRate) * item.qty;
      const customsRsd =
        purchaseRsd * (Number(item.customsRate ?? 0) / 100);
      const current = incomingByProduct.get(item.product.id) ?? {
        qty: 0,
        totalCostRsd: 0,
      };
      current.qty += item.qty;
      current.totalCostRsd +=
        purchaseRsd +
        customsRsd +
        Number(item.freightAllocated ?? 0) +
        (allocations.get(item.id) ?? 0);
      incomingByProduct.set(item.product.id, current);
    }

    for (const [productId, incoming] of incomingByProduct) {
      const before = snapshotByProduct.get(productId);
      if (!before) {
        throw new Error(
          "COGS snimak ne sadrži sve artikle porudžbenice. Knjiženje je bezbedno zaustavljeno.",
        );
      }
      if (incoming.qty <= 0) continue;
      const incomingUnitCogs = incoming.totalCostRsd / incoming.qty;
      const bookedCogs = weightedAverageCogs({
        existingQty: before.stock,
        existingUnitCogs: before.cogs ?? incomingUnitCogs,
        incomingQty: incoming.qty,
        incomingUnitCogs,
      });
      await tx.product.update({
        where: { id: productId },
        data: { cogs: bookedCogs },
      });
    }
    return;
  }

  if (order.cogsBookedAt && snapshot) {
    for (const product of snapshot.products) {
      await tx.product.updateMany({
        where: { id: product.productId },
        data: { cogs: product.cogs },
      });
    }
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: {
        cogsBookingSnapshot: Prisma.DbNull,
        cogsBookedAt: null,
      },
    });
  }
}
