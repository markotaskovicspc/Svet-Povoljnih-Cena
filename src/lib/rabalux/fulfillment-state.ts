import type { SupplierFulfillmentStatus } from "@prisma/client";

const SENDABLE = new Set<SupplierFulfillmentStatus>([
  "PENDING",
  "FAILED",
  "SENT",
]);
const CONFIRMABLE = new Set<SupplierFulfillmentStatus>(["SENT", "CONFIRMED"]);
const RESENDABLE = new Set<SupplierFulfillmentStatus>(["SENT", "FAILED"]);

export function canSendSupplierOrder(status: SupplierFulfillmentStatus) {
  return SENDABLE.has(status);
}

export function canConfirmSupplierFulfillment(status: SupplierFulfillmentStatus) {
  return CONFIRMABLE.has(status);
}

export function canResendSupplierOrder(status: SupplierFulfillmentStatus) {
  return RESENDABLE.has(status);
}
