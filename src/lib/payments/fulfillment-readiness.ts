import type {
  PaymentMethod,
  PaymentStatus,
  ShipmentPurpose,
} from "@prisma/client";

const CASH_ON_DELIVERY_METHODS: readonly PaymentMethod[] = [
  "POUZECE_GOTOVINA",
  "POUZECE_KARTICA",
];

const SUCCESSFUL_ONLINE_STATUSES: readonly PaymentStatus[] = [
  "AUTHORIZED",
  "PAID",
];

export type FulfillmentPaymentReadiness =
  | { ready: true; reason: null }
  | { ready: false; reason: string };

/**
 * One business rule shared by picking, labels and every courier provider.
 * Reclamation shipments and cash-on-delivery orders do not wait for an
 * incoming payment. Bank transfers must be fully marked PAID; online methods
 * may continue after authorization or settlement.
 */
export function fulfillmentPaymentReadiness(args: {
  purpose: ShipmentPurpose;
  paymentMethod: PaymentMethod;
  paymentStatuses: readonly PaymentStatus[];
}): FulfillmentPaymentReadiness {
  if (args.purpose !== "ORDER_DELIVERY") {
    return { ready: true, reason: null };
  }
  if (CASH_ON_DELIVERY_METHODS.includes(args.paymentMethod)) {
    return { ready: true, reason: null };
  }

  const ready =
    args.paymentMethod === "UPLATA_NA_RACUN"
      ? args.paymentStatuses.includes("PAID")
      : args.paymentStatuses.some((status) =>
          SUCCESSFUL_ONLINE_STATUSES.includes(status),
        );
  if (ready) return { ready: true, reason: null };

  return {
    ready: false,
    reason:
      args.paymentMethod === "UPLATA_NA_RACUN"
        ? "Uplata na račun još nije potvrđena."
        : "Elektronsko plaćanje još nije uspešno ili autorizovano.",
  };
}

export function assertFulfillmentPaymentReady(args: {
  orderNumber: string;
  purpose: ShipmentPurpose;
  paymentMethod: PaymentMethod;
  paymentStatuses: readonly PaymentStatus[];
}) {
  const result = fulfillmentPaymentReadiness(args);
  if (!result.ready) {
    throw new Error(
      `Porudžbina ${args.orderNumber} ne može u adresnicu ili kurirski nalog. ${result.reason}`,
    );
  }
}

export function isCashOnDeliveryPaymentMethod(method: PaymentMethod) {
  return CASH_ON_DELIVERY_METHODS.includes(method);
}
