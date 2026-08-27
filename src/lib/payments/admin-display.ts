import type { PaymentMethod, PaymentStatus } from "@prisma/client";

export const ADMIN_PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  IPS: "IPS QR",
  KARTICA: "Platna kartica",
  GOOGLE_PAY: "Google Pay",
  APPLE_PAY: "Apple Pay",
  UPLATA_NA_RACUN: "Uplata na račun",
  POUZECE_GOTOVINA: "Pouzeće — gotovina",
  POUZECE_KARTICA: "Pouzeće — kartica",
};

export const ADMIN_PAYMENT_METHOD_OPTIONS = [
  ADMIN_PAYMENT_METHOD_LABELS.UPLATA_NA_RACUN,
  ADMIN_PAYMENT_METHOD_LABELS.POUZECE_GOTOVINA,
  ADMIN_PAYMENT_METHOD_LABELS.POUZECE_KARTICA,
  ADMIN_PAYMENT_METHOD_LABELS.KARTICA,
  ADMIN_PAYMENT_METHOD_LABELS.IPS,
  ADMIN_PAYMENT_METHOD_LABELS.GOOGLE_PAY,
  ADMIN_PAYMENT_METHOD_LABELS.APPLE_PAY,
];

export const ADMIN_PAYMENT_STATUS_OPTIONS = [
  "Čeka uplatu",
  "Čeka potvrdu",
  "Plaća se kuriru",
  "Autorizovano",
  "Plaćeno",
  "Neuspešno",
  "Delimično refundirano",
  "Refundirano",
];

export function adminPaymentMethodLabel(method: PaymentMethod) {
  return ADMIN_PAYMENT_METHOD_LABELS[method];
}

/**
 * Human-facing status for order monitoring. Payment attempts are ordered from
 * newest to oldest. Any settled/authorized attempt wins because fulfillment
 * uses the same readiness rule; a newer PENDING retry must not hide an already
 * successful payment.
 */
export function adminPaymentStatusLabel(args: {
  paymentMethod: PaymentMethod;
  paymentStatuses: readonly PaymentStatus[];
}) {
  const latestStatus = args.paymentStatuses[0];

  if (latestStatus === "PARTIAL_REFUND") return "Delimično refundirano";
  if (latestStatus === "REFUNDED") return "Refundirano";
  if (args.paymentStatuses.includes("PAID")) return "Plaćeno";
  if (args.paymentStatuses.includes("AUTHORIZED")) return "Autorizovano";

  if (
    args.paymentMethod === "POUZECE_GOTOVINA" ||
    args.paymentMethod === "POUZECE_KARTICA"
  ) {
    return "Plaća se kuriru";
  }
  if (latestStatus === "FAILED") return "Neuspešno";
  if (args.paymentMethod === "UPLATA_NA_RACUN") return "Čeka uplatu";
  return "Čeka potvrdu";
}
