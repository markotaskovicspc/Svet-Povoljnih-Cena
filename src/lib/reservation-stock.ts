export type OrderReservationQuantity = {
  qty: number;
  /** Omitted means a legacy reservation that already reduced stored stock. */
  debited?: boolean;
};

export type FiscalReservationPosting =
  | { type: "already-debited" }
  | { type: "debit"; warehouseId: string };

export function resolveFiscalReservationPosting(input: {
  movementQtys: number[];
  warehouseId: string | null;
}): FiscalReservationPosting {
  const ledgerNet = input.movementQtys.reduce((sum, qty) => sum + qty, 0);
  if (ledgerNet < 0) return { type: "already-debited" };
  if (!input.warehouseId) {
    throw new Error("DC rezervacija nema upisan magacin.");
  }
  return { type: "debit", warehouseId: input.warehouseId };
}

export function reservationQuantityTotals(
  reservations: OrderReservationQuantity[],
) {
  return reservations.reduce(
    (totals, reservation) => {
      const qty = Math.max(0, reservation.qty);
      totals.reserved += qty;
      if (reservation.debited ?? true) totals.debited += qty;
      else totals.pending += qty;
      return totals;
    },
    { reserved: 0, debited: 0, pending: 0 },
  );
}

/**
 * Supports a safe rolling transition:
 * - legacy reservations already reduced storedQty, so add them back to show
 *   physical stock;
 * - new reservations leave storedQty physical and reduce only availability.
 */
export function resolveStoredWarehouseBalance(input: {
  storedQty: number;
  orderReservations: OrderReservationQuantity[];
  partnerReserved?: number;
}) {
  const order = reservationQuantityTotals(input.orderReservations);
  const partnerReserved = Math.max(0, input.partnerReserved ?? 0);
  const physical = input.storedQty + order.debited;
  const reserved = order.reserved + partnerReserved;
  return {
    physical,
    reserved,
    available: Math.max(physical - reserved, 0),
    orderReserved: order.reserved,
    legacyDebitedReserved: order.debited,
    pendingReserved: order.pending,
    partnerReserved,
  };
}
