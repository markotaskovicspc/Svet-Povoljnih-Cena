import type { PaymentMethod, PaymentStatus, ShipmentPurpose } from "@prisma/client";
import { fulfillmentPaymentReadiness } from "@/lib/payments/fulfillment-readiness";

export function isXExpressAnnouncementPaymentReady(args: {
  purpose: ShipmentPurpose;
  paymentMethod: PaymentMethod;
  paymentStatuses: readonly PaymentStatus[];
}) {
  return fulfillmentPaymentReadiness(args).ready;
}
