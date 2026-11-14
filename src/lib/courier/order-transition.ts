import type { OrderStatus, ShipmentStatus } from "@prisma/client";
import { isXExpressReturnCode } from "@/lib/x-express/status";

const X_EXPRESS = "X_EXPRESS";

/**
 * Map a shipment status to the canonical `OrderStatus` we surface in the
 * customer timeline. Returning `null` means "no order-level transition".
 */
export function orderStatusFor(status: ShipmentStatus): OrderStatus | null {
  switch (status) {
    case "PICKED_UP":
      return "SPREMNO_ZA_ISPORUKU";
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return "U_ISPORUCI";
    case "DELIVERED":
      return "ISPORUCENO";
    case "RETURNED":
      return "VRACENO";
    case "FAILED":
    case "CREATED":
      return null;
  }
}

/**
 * X Express reports "Kreiran povrat" (RETURNING and related codes) as a
 * moving shipment, but the parcel is going back to us, so the order is
 * returned from the customer's point of view.
 */
export function orderStatusForEvent(
  provider: string | null,
  event: { status: ShipmentStatus; providerStatusCode?: string | null },
): OrderStatus | null {
  if (
    provider === X_EXPRESS &&
    event.status === "IN_TRANSIT" &&
    isXExpressReturnCode(event.providerStatusCode)
  ) {
    return "VRACENO";
  }
  return orderStatusFor(event.status);
}

/** A returning parcel's later transit scans must not reopen the order. */
export function keepsReturnedOrder(
  current: OrderStatus,
  next: OrderStatus | null,
) {
  return (
    current === "VRACENO" &&
    (next === "U_ISPORUCI" || next === "SPREMNO_ZA_ISPORUKU")
  );
}
