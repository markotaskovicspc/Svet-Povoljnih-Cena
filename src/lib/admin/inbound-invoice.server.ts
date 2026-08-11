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
  validateInboundInvoiceTotals,
} from "@/lib/admin/inbound-invoice";
import { recomputeIncomingStockForPurchaseOrders } from "@/lib/admin/incoming-stock.server";

export type SaveInboundInvoiceInput = {
  id: string;
  number: string;
  receiptDate: Date;
  purchaseOrderId: string;
  invoiceValueRsd: number;
  customsValueRsd: number;
  transportValueRsd: number;
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
  const amounts = calculateInboundInvoiceAmounts({
    invoiceValueRsd: input.invoiceValueRsd,
    customsValueRsd: input.customsValueRsd,
    transportValueRsd: input.transportValueRsd,
    otherRelatedCostsRsd: 0,
  });
  validateInboundInvoiceTotals(amounts);

  const current = await db.inboundInvoice.findUnique({
    where: { id: input.id },
    select: { lockedAt: true, purchaseOrderId: true },
  });
  if (!current) throw new Error("Ulazna faktura ne postoji.");
  if (current.lockedAt) throw new Error("Zaključana faktura se ne može menjati.");

  const purchaseOrder = await db.purchaseOrder.findUnique({
    where: { id: input.purchaseOrderId },
    select: {
      status: true,
      supplierId: true,
      supplier: { select: { enabled: true } },
    },
  });
  if (!purchaseOrder || purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
    throw new Error("Izabrana porudžbenica nije dostupna.");
  }
  if (!purchaseOrder.supplierId || !purchaseOrder.supplier?.enabled) {
    throw new Error("Porudžbenica nema aktivnog dobavljača.");
  }

  try {
    const updated = await db.inboundInvoice.updateMany({
      where: { id: input.id, lockedAt: null },
      data: {
        number,
        invoiceDate: utcDateOnly(input.receiptDate),
        supplierId: purchaseOrder.supplierId,
        purchaseOrderId: input.purchaseOrderId,
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
      throw new Error("Faktura je u međuvremenu zaključana i nije izmenjena.");
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

export async function cancelInboundInvoice(id: string) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.inboundInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, purchaseOrderId: true },
    });
    if (!invoice) throw new Error("Ulazna faktura ne postoji.");
    if (invoice.status === InboundInvoiceStatus.CANCELLED) return invoice;

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
      inboundInvoices: {
        where: { lockedAt: { not: null }, status: InboundInvoiceStatus.POSTED },
        select: {
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
    invoices: order.inboundInvoices.map((linked) => ({
      netValue: Number(linked.netValue),
      exchangeRate: Number(linked.exchangeRate),
      invoiceValueRsd:
        linked.invoiceValueRsd == null ? null : Number(linked.invoiceValueRsd),
    })),
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
}
