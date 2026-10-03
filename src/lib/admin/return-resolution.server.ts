import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";

export async function assertReturnNotLost(
  tx: Prisma.TransactionClient,
  key: string,
) {
  if (await tx.returnResolution.findUnique({ where: { key } })) {
    throw new Error(
      "Povrat je zatvoren kao izgubljen. Prijem na lager nije dozvoljen.",
    );
  }
}

export async function markReturnLost(input: {
  kind: string;
  id: string;
  reason: string;
  actorId: string;
}) {
  if (!["order", "reshipment", "reclamation"].includes(input.kind) || !input.id)
    throw new Error("Izaberite povrat.");
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500)
    throw new Error("Unesite razlog gubitka (5–500 znakova).");
  const key = `${input.kind}:${input.id}`;
  return db.$transaction(
    async (tx) => {
      const retry =
        input.kind === "reshipment"
          ? await tx.orderReshipment.findUnique({ where: { id: input.id } })
          : null;
      const claim =
        input.kind === "reclamation"
          ? await tx.reclamation.findUnique({ where: { id: input.id } })
          : null;
      const orderId =
        input.kind === "order" ? input.id : (retry?.orderId ?? claim?.orderId);
      if (!orderId) throw new Error("Povrat nije pronađen.");
      await lockOrderReturn(tx, orderId);
      const existing = await tx.returnResolution.findUnique({ where: { key } });
      if (existing) return existing;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, shipments: { include: { reshipment: true } } },
      });
      if (input.kind === "reshipment") {
        const items = await tx.orderReshipmentItem.findMany({
          where: { reshipmentId: input.id },
        });
        if (!items.some((item) => item.receivedQty < item.quantity))
          throw new Error("Povrat je već u celosti primljen.");
      } else if (input.kind === "reclamation") {
        if (
          !order.shipments.some(
            (s) =>
              s.reclamationId === input.id &&
              s.purpose === "RECLAMATION_RETURN",
          )
        )
          throw new Error("Povratna pošiljka ne postoji.");
        if (
          await tx.stockMovement.findUnique({
            where: { idempotencyKey: `reclamation-return:${input.id}` },
          })
        )
          throw new Error("Povrat je već primljen.");
      } else {
        if (
          order.status !== "VRACENO" &&
          !order.shipments.some(
            (s) =>
              s.purpose === "ORDER_DELIVERY" &&
              s.status === "RETURNED" &&
              !s.reshipment,
          )
        )
          throw new Error("Porudžbina nije u povratu.");
        // Old shipments with a replacement have their own stock-only return.
        if (
          !order.shipments.some(
            (s) =>
              s.purpose === "ORDER_DELIVERY" &&
              s.status === "RETURNED" &&
              !s.reshipment,
          ) &&
          order.shipments.some((s) => s.reshipment)
        )
          throw new Error(
            "Koristite povrat stare pošiljke nakon ponovnog slanja.",
          );
        const receipts = await tx.stockMovement.findMany({
          where: {
            orderId,
            idempotencyKey: { startsWith: `order-return:${order.number}:` },
          },
          select: { idempotencyKey: true },
        });
        const keys = new Set(receipts.map((r) => r.idempotencyKey));
        if (
          order.items.every((item) =>
            Array.from({ length: item.qty }, (_, index) =>
              keys.has(`order-return:${order.number}:${item.id}:${index + 1}`),
            ).every(Boolean),
          )
        )
          throw new Error("Povrat je već u celosti primljen.");
      }
      const result = await tx.returnResolution.create({
        data: { key, orderId, actorId: input.actorId, reason },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId,
          status: order.status,
          actorId: input.actorId,
          note: `Povrat ${key} zatvoren: pošiljka izgubljena kod kurira. Razlog: ${reason}. Neprimljena roba nije vraćena na lager; refundacija nije pokrenuta.`,
        },
      });
      return result;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
