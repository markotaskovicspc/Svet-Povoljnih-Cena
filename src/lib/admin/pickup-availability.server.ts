import "server-only";
import { getSelectedSmallParcelProvider } from "@/lib/courier/provider-selection";
import { getMyGlsConfig, requireMyGlsEnabled } from "@/lib/mygls/config";
import { requireXExpressShipmentConfig } from "@/lib/x-express/config";
import { PICKUP_BATCH_EXTERNAL_BLOCK_REASON } from "@/lib/admin/pickup-batch";

function normalizeAvailabilityProvider(value?: string | null) {
  const provider = value?.trim().toUpperCase();
  if (provider === "MYGLS") return "MYGLS";
  if (provider === "X_EXPRESS" || provider === "XPRESS") return "X_EXPRESS";
  return null;
}

export async function getPickupPostingAvailability(
  providerOverride?: string | null,
) {
  const provider = normalizeAvailabilityProvider(providerOverride) ??
    (await getSelectedSmallParcelProvider());
  if (provider === "MYGLS") {
    try {
      requireMyGlsEnabled();
      return {
        available: true as const,
        reason: null,
        provider: "MYGLS" as const,
        mode: "LABELS_THEN_AUTOMATIC_BOOKING" as const,
      };
    } catch (error) {
      const cfg = getMyGlsConfig();
      return {
        available: false as const,
        reason:
          cfg.env === "production" && !cfg.enabled
            ? PICKUP_BATCH_EXTERNAL_BLOCK_REASON
            : error instanceof Error
              ? error.message
              : "MyGLS konfiguracija nije kompletna.",
        provider: "MYGLS" as const,
        mode: "LABELS_THEN_AUTOMATIC_BOOKING" as const,
      };
    }
  }
  try {
    requireXExpressShipmentConfig(true);
    return {
      available: true as const,
      reason: null,
      provider: "X_EXPRESS" as const,
      mode: "LABELS_THEN_AUTOMATIC_BOOKING" as const,
    };
  } catch (error) {
    return {
      available: false as const,
      reason:
        error instanceof Error
          ? error.message
          : "X Express konfiguracija nije kompletna.",
      provider: "X_EXPRESS" as const,
      mode: "LABELS_THEN_AUTOMATIC_BOOKING" as const,
    };
  }
}

