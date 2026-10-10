import type { ShipmentStatus } from "@prisma/client";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";

// Keep the carrier's return-in-progress distinct from a completed return.
// These labels also repair the display of older events saved with generic text.
export const X_EXPRESS_EXCEPTION_LABELS: Record<string, string> = {
  RETURNING: "Kreiran povrat",
  RET_ASSIGNED: "Povrat u toku",
  REVERSE_RETURN: "Povrat u toku",
  REVERSE_RETURNING: "Povrat u toku",
  DLV_FAIL_ADDRESS_ERR: "Netačna adresa",
};

export function xExpressStatusDisplay(input: {
  status: ShipmentStatus;
  providerStatusCode?: string | null;
  message?: string | null;
  dictionaryLabel?: string | null;
}) {
  const code = input.providerStatusCode?.trim().toUpperCase() ?? "";
  const message = input.message?.trim();
  const specificMessage = message && !Object.values(SHIPMENT_STATUS_LABEL).includes(message)
    ? message : null;
  return {
    label: input.dictionaryLabel?.trim() || X_EXPRESS_EXCEPTION_LABELS[code] ||
      specificMessage || code || message || SHIPMENT_STATUS_LABEL[input.status],
    attention: Boolean(X_EXPRESS_EXCEPTION_LABELS[code]) ||
      code.startsWith("DLV_FAIL") || code.startsWith("PCK_FAIL") ||
      input.status === "FAILED" || input.status === "RETURNED",
  };
}
