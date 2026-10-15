import "server-only";
import { exactTownAlias } from "@/lib/x-express/town-aliases";
import { normalizeXExpressPhone } from "@/lib/x-express/payload";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { reclamationAddressSchema } from "@/lib/reclamation-address";
import { isMyGlsReturn, myGlsReturnBooking } from "@/lib/mygls/return-booking";

export async function saveReclamationAddress(id: string, value: unknown) {
  const address = reclamationAddressSchema.parse(value);
  normalizeXExpressPhone(address.shipPhone);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Reclamation" WHERE "id" = ${id} FOR UPDATE`;
    const reclamation = await tx.reclamation.findUniqueOrThrow({ where: { id }, include: {
      shipments: true, pickupBatchLines: { include: { batch: true } },
    } });
    if (reclamation.shipments.some(shipment =>
      !["FAILED", "DELIVERED", "RETURNED"].includes(shipment.status) ||
      (isMyGlsReturn(shipment) && !["CANCELLED", "REJECTED"].includes(myGlsReturnBooking(shipment).state) && shipment.status === "FAILED")
    )) throw new Error("Najpre otkažite postojeći kurirski nalog. Sačuvana izmena ne može promeniti adresu već poslatu kuriru.");
    if (reclamation.pickupBatchLines.some(({ batch }) => batch.status !== "DRAFT" || batch.labelsCreationStartedAt || batch.labelsCreatedAt)) {
      throw new Error("Adresnice za zamenu su već pokrenute. Prvo rešite postojeći kurirski nalog i uklonite zamenu iz zaključanog picking naloga.");
    }
    if (address.shipXExpressTownId) {
      const town = await tx.xExpressTown.findFirst({ where: { id: address.shipXExpressTownId, active: true }, select: { id: true, name: true, postalCode: true } });
      const alias = exactTownAlias(address.shipCity, address.shipPostalCode);
      const expected = alias && alias.townId === town?.id && alias.townName === town.name ? alias : town;
      if (!expected || expected.name !== address.shipCity || expected.postalCode !== address.shipPostalCode) throw new Error("Ponovo izaberite mesto i poštanski broj iz liste.");
    } else throw new Error("Izaberite mesto iz liste da bi kurir dobio tačnu adresu.");
    await tx.reclamation.update({ where: { id }, data: { customerAddress: address } });
    return { before: reclamation.customerAddress, after: address };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
