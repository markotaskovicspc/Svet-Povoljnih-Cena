type ReshipmentSource = {
  status: string;
  provider?: string | null;
  providerStatusCode?: string | null;
  providerShipmentId?: string | null;
  trackingNo?: string | null;
};

/** FAILED alone also covers label creation and pickup errors, before dispatch. */
export function canReshipCourierDelivery(shipment: ReshipmentSource) {
  if (["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "RETURNED"].includes(shipment.status)) return true;
  return shipment.status === "FAILED"
    && shipment.provider === "X_EXPRESS"
    && Boolean(shipment.trackingNo?.trim())
    && Boolean(shipment.providerStatusCode?.trim().toUpperCase().startsWith("DLV_FAIL_"));
}

/** An accepted announcement can lack a pickup scan or later be marked DELETED.
 * Physical handover requires explicit operator confirmation in both cases;
 * a locally prepared or failed announcement is not sufficient. */
export function canConfirmUnscannedXExpressPickup(shipment: ReshipmentSource) {
  const missingPickupScan = shipment.status === "CREATED"
    || (shipment.status === "FAILED" && shipment.providerStatusCode?.trim().toUpperCase() === "DELETED");
  return shipment.provider === "X_EXPRESS"
    && missingPickupScan
    && Boolean(shipment.providerShipmentId?.trim())
    && Boolean(shipment.trackingNo?.trim());
}
