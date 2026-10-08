import type { ShipmentStatus } from "@prisma/client";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";

type ReturnShipment = {
  provider?: string | null;
  purpose?: string;
  status: string;
  providerParcelId?: string | null;
  trackingNo?: string | null;
  syncError?: string | null;
  rawCreateResponse?: unknown;
  packageCount?: number;
  providerParcelNumbers?: unknown;
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function isMyGlsReturn(shipment: Pick<ReturnShipment, "provider" | "purpose">) {
  return shipment.provider === "MYGLS" && shipment.purpose === "RECLAMATION_RETURN";
}
export function myGlsReturnBooking(shipment: ReturnShipment) {
  const raw = record(shipment.rawCreateResponse);
  const booking = record(raw.myGlsReturn);
  const recovery = record(raw.manualRecovery);
  const accepted = booking.state === "ACCEPTED" ||
    (recovery.providerServiceCode === "P&R" && Boolean(recovery.verifiedAt));
  return {
    state: shipment.syncError === "MyGLS etiketa obrisana." ? "CANCELLED" :
      accepted && shipment.providerParcelId && shipment.trackingNo ? "ACCEPTED" :
      booking.state === "REJECTED" ? "REJECTED" :
      booking.state === "PENDING" || booking.state === "UNKNOWN" ? "UNKNOWN" : "LEGACY",
    pickupDate: typeof booking.pickupDate === "string" ? booking.pickupDate :
      typeof recovery.requestedPickupDate === "string" ? recovery.requestedPickupDate : null,
  };
}
export function assertMyGlsReturnAccepted(shipment: ReturnShipment) {
  if (!isMyGlsReturn(shipment)) return;
  const { state } = myGlsReturnBooking(shipment);
  if (state === "ACCEPTED") {
    if (shipment.status !== "FAILED") return;
    throw new Error("GLS je već prihvatio P&R nalog, ali pošiljka ima problem. Proverite postojeći broj kod GLS-a pre novog zahteva.");
  }
  throw new Error(state === "UNKNOWN"
    ? "Ishod GLS P&R zahteva se proverava. Ne šaljite novi nalog; proverite postojeću referencu u MyGLS-u."
    : "GLS preuzimanje nije potvrđeno. Obična adresnica nije P&R nalog; proverite i otkažite stari nalog pre novog zahteva.");
}
export function myGlsReturnStatusLabel(shipment: ReturnShipment) {
  if (!isMyGlsReturn(shipment)) return null;
  const { state } = myGlsReturnBooking(shipment);
  if (state === "CANCELLED") return "P&R / adresnica otkazana";
  if (state === "REJECTED") return "GLS je odbio P&R zahtev — ispravite podatke pre ponovnog slanja";
  if (state === "UNKNOWN") return "Ishod P&R zahteva se proverava — ne šaljite ponovo";
  if (shipment.status === "PICKED_UP") return "Preuzeto kod kupca";
  if (shipment.status === "DELIVERED") return allReturnParcelsDelivered(shipment)
    ? "Dostavljeno na povratnu adresu" : "Čeka se potvrda isporuke svih povratnih paketa";
  if (shipment.status !== "CREATED") return SHIPMENT_STATUS_LABEL[shipment.status as ShipmentStatus] ?? shipment.status;
  return state === "ACCEPTED" ? "P&R zahtev prihvaćen — čeka preuzimanje kod kupca" :
    "Obična adresnica — P&R preuzimanje nije potvrđeno";
}

/** For a reverse shipment, RETURNED can mean sent back to the customer. */
export function canReceiveReclamationShipment(shipment?: ReturnShipment | null) {
  if (shipment?.provider === "MYGLS" && shipment.syncError === "MyGLS etiketa obrisana.") return false;
  return Boolean(shipment && (shipment.status === "DELIVERED"
    ? !isMyGlsReturn(shipment) || allReturnParcelsDelivered(shipment)
    : !isMyGlsReturn(shipment) && shipment.status === "RETURNED"));
}

/** A multi-parcel shipment's latest event is not proof of this parcel's state. */
export function scannedReturnStatusLabel(shipment: ReturnShipment, code: string) {
  if (shipment.provider === "MYGLS") {
    if (shipment.syncError === "MyGLS etiketa obrisana.") return "Adresnica otkazana — potrebna ručna provera";
    const snapshot = record(record(shipment.rawCreateResponse).myGlsParcelHandover);
    const parcels = Array.isArray(snapshot.parcels) ? snapshot.parcels.map(record) : [];
    const parcel = parcels.find(p => String(p.parcelNumber) === String(Number(code)));
    if (parcel && typeof parcel.latestStatusAt === "string" && Number.isFinite(Date.parse(parcel.latestStatusAt))) {
      const status = parcel.latestStatus as ShipmentStatus;
      if (Object.hasOwn(SHIPMENT_STATUS_LABEL, status)) {
        return isMyGlsReturn(shipment) && status === "PICKED_UP" ? "Preuzeto kod kupca" : SHIPMENT_STATUS_LABEL[status];
      }
    }
    if ((shipment.packageCount ?? 1) > 1) return "Status ovog paketa nije potvrđen";
  }
  const label = isMyGlsReturn(shipment) ? myGlsReturnStatusLabel(shipment)! : SHIPMENT_STATUS_LABEL[shipment.status as ShipmentStatus] ?? shipment.status;
  return (shipment.packageCount ?? 1) > 1 ? `Status cele pošiljke: ${label}` : label;
}

function allReturnParcelsDelivered(shipment: ReturnShipment) {
  const count = shipment.packageCount ?? 1;
  if (count <= 1) return true;
  const numbers = Array.isArray(shipment.providerParcelNumbers) ? shipment.providerParcelNumbers.map(Number) : [];
  const snapshot = record(record(shipment.rawCreateResponse).myGlsParcelHandover);
  const parcels = Array.isArray(snapshot.parcels) ? snapshot.parcels.map(record) : [];
  return numbers.length === count && new Set(numbers).size === count && parcels.length === count &&
    numbers.every(number => Number.isFinite(number) && parcels.some(parcel =>
      parcel.parcelNumber === number && parcel.latestStatus === "DELIVERED" &&
      typeof parcel.latestStatusAt === "string" && Number.isFinite(Date.parse(parcel.latestStatusAt))));
}
