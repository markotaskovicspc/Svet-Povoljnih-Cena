import "server-only";
import { db } from "@/lib/db";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";
import { normalizeReturnParcelNumber, returnParcelNumbers } from "./return-parcels";

/** Records warehouse evidence only: no courier request, inventory or refund. */
export async function confirmReturnParcelArrival(input: {
  code: string;
  actorId: string;
}) {
  const code = normalizeReturnParcelNumber(input.code);
  if (!/^[A-Z0-9]{5,40}$/.test(code)) throw new Error("Unesite ili skenirajte važeći kod paketa.");
  const variants = [...new Set([code, /^\d+$/.test(code) ? code.padStart(11, "0") : code])];
  const matches = await db.shipment.findMany({
    where: {
      purpose: { in: ["ORDER_DELIVERY", "RECLAMATION_RETURN"] },
      OR: [
        { trackingNo: { in: variants } },
        ...variants.map((value) => ({ providerParcelNumbers: { array_contains: [value] } })),
        ...(Number.isSafeInteger(Number(code)) ? [{ providerParcelNumbers: { array_contains: [Number(code)] } }] : []),
      ],
    },
    select: { id: true, orderId: true, trackingNo: true, providerParcelNumbers: true },
    take: 2,
  });
  if (matches.length !== 1 || !returnParcelNumbers(matches[0]!).includes(code)) {
    throw new Error(matches.length > 1
      ? "Kod pripada više pošiljki. Proverite evidenciju pre potvrde."
      : "Paket nije pronađen među pošiljkama. Proverite kod sa adresnice.");
  }
  const shipment = matches[0]!;
  return db.$transaction(async (tx) => {
    await lockOrderReturn(tx, shipment.orderId);
    const arrival = await tx.returnParcelArrival.upsert({
      where: { shipmentId_parcelNumber: { shipmentId: shipment.id, parcelNumber: code } },
      create: { shipmentId: shipment.id, parcelNumber: code, actorId: input.actorId, note: "Fizički dolazak potvrđen skeniranjem u pregledu povrata." },
      update: {},
    });
    return { arrival, orderId: shipment.orderId };
  });
}
