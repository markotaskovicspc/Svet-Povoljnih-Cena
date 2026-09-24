/** FAILED alone also covers label creation and pickup errors, before dispatch. */
export function canReshipCourierDelivery(shipment: {
  status: string;
  provider?: string | null;
  providerStatusCode?: string | null;
  trackingNo?: string | null;
}) {
  if (["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "RETURNED"].includes(shipment.status)) return true;
  return shipment.status === "FAILED"
    && shipment.provider === "X_EXPRESS"
    && Boolean(shipment.trackingNo?.trim())
    && Boolean(shipment.providerStatusCode?.trim().toUpperCase().startsWith("DLV_FAIL_"));
}
