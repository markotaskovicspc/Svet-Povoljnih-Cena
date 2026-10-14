import "server-only";
import { db } from "@/lib/db";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";
import { normalizeReturnParcelNumber } from "./return-parcels";
import { myGlsBarcodeParcelNumber } from "@/lib/mygls/parcel-barcode";

import { canonicalReturnParcel } from "./return-receipt-plan";

export async function findReturnParcel(input: string) {
  const code = normalizeReturnParcelNumber(input);
  if (!/^[A-Z0-9]{5,40}$/.test(code)) throw new Error("Unesite ili skenirajte važeći kod paketa.");
  const variants = [...new Set([code, /^\d+$/.test(code) ? code.padStart(11, "0") : code])];
  const barcodeNumber = myGlsBarcodeParcelNumber(code);
  const matches = await db.shipment.findMany({
    where: { purpose: { in: ["ORDER_DELIVERY", "RECLAMATION_RETURN"] }, OR: [
      { trackingNo: { in: variants } },
      ...variants.map(value => ({ providerParcelNumbers: { array_contains: [value] } })),
      ...(barcodeNumber ? [{ provider: "MYGLS", OR: [
        { trackingNo: { in: [barcodeNumber, barcodeNumber.padStart(11, "0")] } },
        ...[barcodeNumber, barcodeNumber.padStart(11, "0"), Number(barcodeNumber)]
          .map(value => ({ providerParcelNumbers: { array_contains: [value] } })),
      ] }] : []),
      ...(Number.isSafeInteger(Number(code)) ? [
        { providerParcelNumbers: { array_contains: [Number(code)] } },
        ...["PrintLabelsInfoList", "PrintDataInfoList"].flatMap(path => ["ParcelNumber", "ParcelNumberWithCheckdigit"].map(field => ({ provider: "MYGLS", rawCreateResponse: { path: [path], array_contains: [{ [field]: Number(code) }] } }))),
      ] : []),
    ] },
    include: { pickupBatchLines: { select: { providerParcelNumber: true, packedItems: true, orderItemId: true, packedQuantity: true } }, returnArrivals: true, order: { include: { items: { include: { product: { select: { barcode: true, shortDescription: true, collection: { select: { name: true } }, attribute1: true, attribute2: true, attribute3: true, attribute4: true, colorPrimary: true, colorSecondary: true } } } } } }, reclamation: true, reshipment: { include: { items: true } } },
    take: 2,
  });
  if (matches.length !== 1) throw new Error(matches.length > 1 ? "Kod pripada više pošiljki. Proverite evidenciju." : "Paket nije pronađen. Proverite kod sa adresnice.");
  const shipment = matches[0]!;
  const canonical = canonicalReturnParcel(shipment, code);
  if (!canonical) throw new Error("Kod paketa nije pouzdano povezan sa pošiljkom.");
  return { shipment, code: canonical };
}

/** Records warehouse evidence only: no courier request, inventory or refund. */
export async function confirmReturnParcelArrival(input: {
  code: string;
  actorId: string;
}, resolved?: Awaited<ReturnType<typeof findReturnParcel>>) {
  // Only a trusted server-side receipt plan may supply the already validated
  // parcel. Other callers still perform the full identity/ambiguity check.
  const { shipment, code } = resolved ?? await findReturnParcel(input.code);
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
