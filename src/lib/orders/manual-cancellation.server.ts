import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { restoreOrderReservations } from "@/lib/order-reservations";
import { assertOrderCancellationBeforeCourier } from "./cancellation-courier.server";

/** Cancels an unpaid, undocumented manual order while preserving its history. */
export async function cancelManualSalesOrder(orderId: string, actorId: string) {
  if (!orderId.trim()) throw new Error("Nedostaje porudžbina.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { dispatchNoteItems: {
          where: { dispatchNote: { status: { not: "CANCELLED" } } }, select: { id: true },
        } } },
        payments: { select: { status: true } },
        fiscal: { select: { id: true } },
        fiscalDocuments: { select: { id: true } },
        invoices: { where: { kind: "BUYER_RECEIPT", status: { not: "CANCELLED" } }, select: { id: true } },
        sefDocuments: { where: { direction: "OUT", environment: "production", status: { notIn: ["DRAFT", "ERROR"] } }, select: { id: true } },
        dispatchNotes: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
        reshipments: { select: { id: true } },
        supplierFulfillments: { select: { id: true } },
        paymentRefunds: { select: { id: true } },
        reclamations: { select: { id: true } },
      },
    });
    if (!order) throw new Error("Porudžbina ne postoji.");
    if (!["MP", "VP", "INO"].includes(order.channel)) {
      throw new Error("Ova komanda je dostupna samo za ručne MP/VP/INO porudžbine.");
    }
    if (order.status === "OTKAZANO") return { id: order.id, number: order.number, alreadyCancelled: true };
    if (!["KREIRANO", "POTVRDJENO", "U_PRIPREMI", "SPREMNO_ZA_ISPORUKU"].includes(order.status) ||
        order.cancelledAt || order.stockRestoredAt) {
      throw new Error("Porudžbina u ovom statusu ne može da se otkaže ovim putem.");
    }
    if (order.payments.some((payment) => !["PENDING", "FAILED"].includes(payment.status)) || order.paymentRefunds.length || order.courierPaidAt) {
      throw new Error("Porudžbina ima naplatu ili povraćaj novca. Najpre usaglasite plaćanje.");
    }
    if (order.fiscal || order.fiscalDocuments.length || order.invoices.length || order.sefDocuments.length || order.sefAcceptedAt) {
      throw new Error("Porudžbina ima izdat račun ili fiskalnu/SEF dokumentaciju. Potrebno je usaglašavanje dokumenata.");
    }
    if (order.dispatchNotes.length || order.reshipments.length || order.reclamations.length ||
        order.items.some((item) => item.warehouseDispatchedQty > 0 || item.dispatchNoteItems.length)) {
      throw new Error("Porudžbina ima otpremu, ponovno slanje ili reklamaciju. Najpre usaglasite fizičko stanje robe.");
    }
    if (order.supplierFulfillments.length || order.items.some((item) => item.supplierReservedQty > 0)) {
      throw new Error("Porudžbina ima realizaciju kod dobavljača. Najpre usaglasite obustavu sa dobavljačem.");
    }
    const fiscalJobs = await tx.backgroundJob.findMany({
      where: {
        idempotencyKey: { in: [`fiscal-advance:${orderId}`, `fiscal-pickup:${orderId}`] },
        status: { in: ["QUEUED", "RETRY", "RUNNING"] },
      },
      select: { id: true },
    });
    if (fiscalJobs.length) throw new Error("Fiskalizacija je zakazana ili u toku. Najpre proverite njenu obradu.");
    await assertOrderCancellationBeforeCourier(tx, orderId, { allowConfirmedDeleted: true });
    const skus = [...new Set(order.items.map((item) => item.sku))];
    if (skus.length) await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Product" WHERE "sku" IN (${Prisma.join(skus)}) ORDER BY "id" FOR UPDATE
    `);
    await restoreOrderReservations(tx, {
      orderId, orderNumber: order.number, items: order.items, actorId,
      reasonKey: "manual-cancel", note: `Otkazivanje ručne porudžbine ${order.number}`,
    });
    const now = new Date();
    await tx.order.update({ where: { id: orderId }, data: { status: "OTKAZANO", cancelledAt: now, stockRestoredAt: now } });
    await tx.orderStatusEvent.create({ data: {
      orderId, status: "OTKAZANO", actorId,
      note: "Cela ručna porudžbina je otkazana; rezervacije svih artikala su oslobođene.",
    } });
    return { id: order.id, number: order.number, alreadyCancelled: false };
  }, { maxWait: 10_000, timeout: 30_000 });
}
