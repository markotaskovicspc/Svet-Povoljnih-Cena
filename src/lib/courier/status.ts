import type { ShipmentStatus } from "@prisma/client";

/**
 * Maps a provider status code (X Express-style alphanumeric, plus the bulky
 * dispatcher's Serbian short codes) to our internal `ShipmentStatus`.
 *
 * Unknown codes return `null` so the webhook handler can log + ignore
 * instead of mis-classifying the shipment.
 */
const X_EXPRESS_MAP: Record<string, ShipmentStatus> = {
  CREATED: "CREATED",
  REGISTERED: "CREATED",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  IN_HUB: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  RETURNED: "RETURNED",
  REFUSED: "RETURNED",
  FAILED: "FAILED",
  EXCEPTION: "FAILED",
};

const BULKY_MAP: Record<string, ShipmentStatus> = {
  // In-house dispatcher codes (Serbian short-codes from the kamion ekipa)
  KREIRANO: "CREATED",
  PREUZETO: "PICKED_UP",
  U_TRANZITU: "IN_TRANSIT",
  ZA_ISPORUKU: "OUT_FOR_DELIVERY",
  ISPORUCENO: "DELIVERED",
  VRACENO: "RETURNED",
  NEUSPESNO: "FAILED",
};

export function mapSmallParcelStatus(code: string): ShipmentStatus | null {
  return X_EXPRESS_MAP[code.toUpperCase()] ?? null;
}

export const mapXExpressStatus = mapSmallParcelStatus;

export function mapBulkyStatus(code: string): ShipmentStatus | null {
  return BULKY_MAP[code.toUpperCase()] ?? null;
}

/** Serbian Latin label used in account timeline + customer notifications. */
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  CREATED: "Pošiljka kreirana",
  PICKED_UP: "Preuzeto iz magacina",
  IN_TRANSIT: "U tranzitu",
  OUT_FOR_DELIVERY: "Na isporuci",
  DELIVERED: "Isporučeno",
  RETURNED: "Vraćeno",
  FAILED: "Neuspešna isporuka",
};
