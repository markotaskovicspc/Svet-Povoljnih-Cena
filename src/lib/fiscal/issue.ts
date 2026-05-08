import "server-only";

import { Prisma, type Order, type OrderItem, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { fiscalize, type FiscalDispatchResult } from "./transport";

/**
 * Phase 4F — Issue a fiscal receipt for an order.
 *
 * Idempotent on `Order.id`: an existing `FiscalReceipt` row is returned
 * unchanged. Otherwise we call the gateway, persist the receipt, and
 * return both the row and the dispatch result so the caller (admin
 * action / courier hook) can decide whether to attach a PDF and email
 * the customer.
 */

export type FiscalIssueOutcome =
  | {
      ok: true;
      created: boolean;
      receipt: { id: string; receiptNumber: string; qrUrl: string | null; fiscalizedAt: Date };
      order: OrderWithItems;
    }
  | { ok: false; error: string; reason: "not_found" | "already_issued" | "gateway_failure" };

type OrderWithItems = Order & { items: OrderItem[] };

const PAYMENT_METHOD_GATEWAY: Record<PaymentMethod, "CASH" | "CARD" | "TRANSFER" | "OTHER"> = {
  POUZECE_GOTOVINA: "CASH",
  POUZECE_KARTICA: "CARD",
  KARTICA: "CARD",
  GOOGLE_PAY: "CARD",
  APPLE_PAY: "CARD",
  IPS: "TRANSFER",
  UPLATA_NA_RACUN: "TRANSFER",
};

export async function issueFiscalReceiptForOrder(
  orderId: string,
): Promise<FiscalIssueOutcome> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, fiscal: true },
  });
  if (!order) {
    return { ok: false, reason: "not_found", error: `Order ${orderId} ne postoji.` };
  }

  if (order.fiscal) {
    const { fiscal, ...rest } = order;
    return {
      ok: true,
      created: false,
      receipt: {
        id: fiscal.id,
        receiptNumber: fiscal.receiptNumber,
        qrUrl: fiscal.qrUrl,
        fiscalizedAt: fiscal.fiscalizedAt,
      },
      order: rest,
    };
  }

  const dispatch: FiscalDispatchResult = await fiscalize({
    invoiceRef: order.number,
    total: Number(order.total),
    paymentMethod: PAYMENT_METHOD_GATEWAY[order.paymentMethod],
    buyer: order.billPib
      ? {
          tin: order.billPib,
          name: order.billCompanyName ?? `${order.shipFirstName} ${order.shipLastName}`,
        }
      : undefined,
    lines: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPrice: Number(i.unitPriceSale) + (i.withAssembly && i.assemblyPrice ? Number(i.assemblyPrice) : 0),
    })),
  });

  if (!dispatch.ok) {
    return { ok: false, reason: "gateway_failure", error: dispatch.error };
  }

  // Persist; race-safe via the unique index on `orderId`. If another
  // request beat us to it, fall back to the existing row.
  try {
    const fiscal = await db.fiscalReceipt.create({
      data: {
        orderId: order.id,
        receiptNumber: dispatch.receipt.receiptNumber,
        qrUrl: dispatch.receipt.qrUrl,
        rawResponse: dispatch.receipt.raw as Prisma.InputJsonValue,
        fiscalizedAt: new Date(dispatch.receipt.fiscalizedAt),
      },
    });
    return {
      ok: true,
      created: true,
      receipt: {
        id: fiscal.id,
        receiptNumber: fiscal.receiptNumber,
        qrUrl: fiscal.qrUrl,
        fiscalizedAt: fiscal.fiscalizedAt,
      },
      order,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.fiscalReceipt.findUnique({ where: { orderId: order.id } });
      if (existing) {
        return {
          ok: true,
          created: false,
          receipt: {
            id: existing.id,
            receiptNumber: existing.receiptNumber,
            qrUrl: existing.qrUrl,
            fiscalizedAt: existing.fiscalizedAt,
          },
          order,
        };
      }
    }
    throw err;
  }
}

/**
 * Convenience wrapper used by the courier `PICKED_UP` hook and the
 * admin "mark picked up" action. Logs (but never throws) so a transient
 * gateway error doesn't roll back the warehouse pickup itself.
 */
export async function tryIssueFiscalReceipt(orderId: string): Promise<FiscalIssueOutcome> {
  try {
    const outcome = await issueFiscalReceiptForOrder(orderId);
    if (!outcome.ok) {
      console.error(`[fiscal] issue failed for ${orderId}: ${outcome.error}`);
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fiscal] issue threw for ${orderId}: ${message}`);
    return { ok: false, reason: "gateway_failure", error: message };
  }
}

export function paymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case "POUZECE_GOTOVINA":
      return "Pouzećem (gotovina)";
    case "POUZECE_KARTICA":
      return "Pouzećem (kartica)";
    case "KARTICA":
      return "Platna kartica";
    case "GOOGLE_PAY":
      return "Google Pay";
    case "APPLE_PAY":
      return "Apple Pay";
    case "IPS":
      return "IPS QR";
    case "UPLATA_NA_RACUN":
      return "Uplata na račun";
  }
}
