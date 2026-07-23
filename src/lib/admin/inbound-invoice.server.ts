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
  allocateInvoiceCostsByOrderValue,
  validateInboundInvoiceTotals,
} from "@/lib/admin/inbound-invoice";

export type SaveInboundInvoiceInput = {
  id: string;
  number: string;
  receiptDate: Date;
  supplierId: string;
  purchaseOrderId: string;
  type: InboundInvoiceType;
  currency: ErpCurrency;
  exchangeRate: number;
  netValue: number;
  vatValue: number;
  grossValue: number;
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
          type: InboundInvoiceType.DOM,
          status: InboundInvoiceStatus.DRAFT,
          invoiceDate: utcDateOnly(now),
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
  if (!input.supplierId) throw new Error("Naziv dobavljača je obavezan.");
  if (!input.purchaseOrderId) throw new Error("Veza sa dokumentom je obavezna.");
  validateInboundInvoiceTotals(input);
  if (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0) {
    throw new Error("Kurs mora biti veći od nule.");
  }

  const current = await db.inboundInvoice.findUnique({
    where: { id: input.id },
    select: { lockedAt: true },
  });
  if (!current) throw new Error("Ulazna faktura ne postoji.");
  if (current.lockedAt) throw new Error("Zaključana faktura se ne može menjati.");

  const [supplier, purchaseOrder] = await Promise.all([
    db.supplier.findUnique({
      where: { id: input.supplierId },
      select: { enabled: true },
    }),
    db.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: { status: true },
    }),
  ]);
  if (!supplier?.enabled) throw new Error("Izabrani dobavljač nije aktivan.");
  if (!purchaseOrder || purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
    throw new Error("Izabrana porudžbenica nije dostupna.");
  }

  try {
    const updated = await db.inboundInvoice.updateMany({
      where: { id: input.id, lockedAt: null },
      data: {
        number,
        invoiceDate: utcDateOnly(input.receiptDate),
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId,
        type: input.type,
        currency: input.currency,
        exchangeRate: input.currency === ErpCurrency.RSD ? 1 : input.exchangeRate,
        value: input.netValue,
        netValue: input.netValue,
        vatValue: input.vatValue,
        grossValue: input.grossValue,
        allocationBasis: "VALUE",
        status: InboundInvoiceStatus.RECEIVED,
        cogsStatus: CogsStatus.PENDING,
        notes: input.notes,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Faktura je u međuvremenu zaključana i nije izmenjena.");
    }
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
    if (invoice.lockedAt) return invoice;
    if (!invoice.invoiceDate) throw new Error("Datum prijema je obavezan.");
    if (!invoice.supplier) throw new Error("Naziv dobavljača je obavezan.");
    if (!invoice.purchaseOrder) {
      throw new Error("Veza sa porudžbenicom je obavezna za COGS obračun.");
    }
    if (!invoice.purchaseOrder.items.length) {
      throw new Error("Povezana porudžbenica nema artikle za COGS obračun.");
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

    const linkedInvoices = await tx.inboundInvoice.findMany({
      where: {
        purchaseOrderId: invoice.purchaseOrder.id,
        lockedAt: { not: null },
        status: InboundInvoiceStatus.POSTED,
      },
      select: { netValue: true, exchangeRate: true },
    });
    const linkedCostRsd = linkedInvoices.reduce(
      (sum, linked) =>
        sum + Number(linked.netValue) * Number(linked.exchangeRate),
      0,
    );
    const allocations = allocateInvoiceCostsByOrderValue(
      linkedCostRsd,
      invoice.purchaseOrder.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        qty: item.qty,
        purchasePrice:
          Number(item.purchasePrice) * Number(invoice.purchaseOrder?.exchangeRate ?? 1),
      })),
    );

    const lateCostByProduct = new Map<
      string,
      { delta: number; stock: number; currentCogs: number }
    >();
    for (const item of invoice.purchaseOrder.items) {
      const previous = Number(item.additionalCostAllocated ?? 0);
      const next = allocations.get(item.id) ?? 0;
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { additionalCostAllocated: next },
      });
      if (
        invoice.purchaseOrder.status === PurchaseOrderStatus.RECEIVED &&
        item.product
      ) {
        const current = lateCostByProduct.get(item.product.id) ?? {
          delta: 0,
          stock: item.product.stock,
          currentCogs: Number(item.product.cogs ?? 0),
        };
        current.delta += next - previous;
        lateCostByProduct.set(item.product.id, current);
      }
    }

    // When an ancillary invoice arrives after goods receipt, capitalize the
    // new delta over the units still on hand. The normal path remains invoice
    // lock first, then receipt, where the full weighted-average formula runs.
    for (const [productId, cost] of lateCostByProduct) {
      if (cost.delta !== 0 && cost.stock > 0) {
        await tx.product.update({
          where: { id: productId },
          data: {
            cogs: Number(
              (cost.currentCogs + cost.delta / cost.stock).toFixed(2),
            ),
          },
        });
      }
    }

    return tx.inboundInvoice.findUniqueOrThrow({ where: { id } });
  });
}
