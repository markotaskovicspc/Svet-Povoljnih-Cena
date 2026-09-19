import "server-only";
import { db } from "@/lib/db";
import { withOrderReturnLock } from "./return-lock";
import { issueFiscalRefundUnderLock } from "./issue";
import { PermanentBackgroundJobError } from "@/lib/background-jobs";

export async function refundReceivedOrder(input: { movementId: string; buyerId?: string; actorId?: string }) {
  const receipt = await db.stockMovement.findUnique({ where: { id: input.movementId } });
  if (!receipt?.orderId || !receipt.orderItemId || !receipt.idempotencyKey?.startsWith("order-return:")) {
    throw new PermanentBackgroundJobError("Prijem vraćenog paketa nije pronađen.");
  }
  const orderId = receipt.orderId;
  const orderItemId = receipt.orderItemId;
  return withOrderReturnLock(orderId, async () => {
    const [receipts, lines] = await Promise.all([
      db.stockMovement.count({ where: { orderItemId, idempotencyKey: { startsWith: "order-return:" } } }),
      db.fiscalDocumentLine.findMany({
        where: { orderItemId, fiscalDocument: { kind: "SALE", status: "ISSUED" } },
        include: { fiscalDocument: true },
        orderBy: { id: "asc" },
      }),
    ]);
    if (!lines.length) {
      // A sale might still be in flight: do not silently mark this as refunded.
      throw new Error("Paket je primljen; nema izdatog fiskalnog računa za refundaciju. Proverite fiskalizaciju porudžbine.");
    }
    let remaining = Math.max(0, receipts - lines.reduce((sum, line) => sum + line.refundedQty, 0));
    if (!remaining) return;
    for (const line of lines) {
      const qty = Math.min(remaining, line.qty - line.refundedQty);
      if (qty <= 0) continue;
      const buyerId = input.buyerId?.trim() || line.fiscalDocument.buyerId;
      if (!buyerId || !/^\d{1,2}:\S+$/.test(buyerId)) {
        throw new Error("Paket je primljen — refundacija čeka identifikaciju kupca. Dopunite podatak i ponovite obradu.");
      }
      const method = line.fiscalDocument.paymentMethod;
      if (!method) throw new Error("Originalni fiskalni račun nema način plaćanja; potrebna je provera.");
      const result = await issueFiscalRefundUnderLock({
        fiscalLineIds: [line.id], quantities: { [line.id]: qty },
        paymentReturnMethod: method, buyerId, warehouseId: receipt.warehouseId,
        actorId: input.actorId ?? receipt.actorId,
      });
      if (!result.ok) throw new Error(result.error);
      // Financial follow-up has its own durable PAYMENT_REFUND job and status.
      remaining -= qty;
    }
    if (remaining > 0) throw new Error("Primljena količina premašuje fiskalizovanu količinu; potrebna je provera preostalog povrata.");
  });
}
