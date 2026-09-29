/** Cancellation stops outgoing order goods; returns/replacements have their own lifecycle. */
export function isCancelledDelivery(line: {
  purpose?: string;
  order?: { status?: string; cancelledAt?: unknown };
}) {
  return line.purpose === "ORDER_DELIVERY" &&
    (line.order?.status === "OTKAZANO" || Boolean(line.order?.cancelledAt));
}
