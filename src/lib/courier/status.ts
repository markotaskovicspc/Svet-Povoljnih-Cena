import type { OrderStatus, ShipmentStatus } from "@prisma/client";

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
  ANNOUNCED: "CREATED",
  PICKEDUP: "PICKED_UP",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  IN_HUB: "IN_TRANSIT",
  DLV_ASSIGNED: "OUT_FOR_DELIVERY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  RETURNED: "RETURNED",
  REFUSED: "RETURNED",
  REVERSE_DELIVERY: "RETURNED",
  FAILED: "FAILED",
  EXCEPTION: "FAILED",
  PCK_FAIL_CONTENT_ERR: "FAILED",
  PCK_FAIL_LATE: "FAILED",
  PCK_FAIL_ADDRESS_ERR: "FAILED",
  PCK_FAIL_CANCELED: "FAILED",
  DLV_FAIL_PHONE_ERR: "FAILED",
  DLV_FAIL_DAMAGED: "FAILED",
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
  const normalized = code.toUpperCase();
  if (normalized.startsWith("PCK_FAIL") || normalized.startsWith("DLV_FAIL")) {
    return "FAILED";
  }
  return X_EXPRESS_MAP[normalized] ?? null;
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

const ACTIVE_ORDER_STATUS_RANK: Partial<Record<OrderStatus, number>> = {
  KREIRANO: 0,
  POTVRDJENO: 1,
  U_PRIPREMI: 2,
  SPREMNO_ZA_ISPORUKU: 3,
  U_ISPORUCI: 4,
  ISPORUCENO: 5,
};

/**
 * Resolve an order-level status from one shipment event without letting a
 * split X Express/MyGLS order regress or become delivered too early.
 */
export function orderStatusForDeliveryShipments(input: {
  eventStatus: ShipmentStatus;
  currentOrderStatus: OrderStatus;
  deliveryShipmentStatuses: readonly ShipmentStatus[];
}): OrderStatus | null {
  const { eventStatus, currentOrderStatus, deliveryShipmentStatuses } = input;

  if (eventStatus === "RETURNED") return "VRACENO";
  if (eventStatus === "FAILED" || eventStatus === "CREATED") return null;
  if (currentOrderStatus === "OTKAZANO" || currentOrderStatus === "VRACENO") {
    return null;
  }

  let candidate: OrderStatus;
  if (eventStatus === "PICKED_UP") {
    candidate = "SPREMNO_ZA_ISPORUKU";
  } else if (eventStatus === "DELIVERED") {
    const allDelivered =
      deliveryShipmentStatuses.length > 0 &&
      deliveryShipmentStatuses.every((status) => status === "DELIVERED");
    candidate = allDelivered ? "ISPORUCENO" : "U_ISPORUCI";
  } else {
    candidate = "U_ISPORUCI";
  }

  const currentRank = ACTIVE_ORDER_STATUS_RANK[currentOrderStatus];
  const candidateRank = ACTIVE_ORDER_STATUS_RANK[candidate];
  if (
    currentRank !== undefined &&
    candidateRank !== undefined &&
    currentRank >= candidateRank
  ) {
    return null;
  }
  return candidate;
}
