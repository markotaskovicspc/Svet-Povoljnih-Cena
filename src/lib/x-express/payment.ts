import type {
  PaymentMethod,
  PaymentStatus,
  ShipmentPurpose,
} from "@prisma/client";
import { isXExpressCashOnDelivery } from "./payload";

const SUCCESSFUL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "AUTHORIZED",
  "PAID",
];

export function isXExpressAnnouncementPaymentReady(args: {
  purpose: ShipmentPurpose;
  paymentMethod: PaymentMethod;
  paymentStatuses: readonly PaymentStatus[];
}) {
  return (
    args.purpose !== "ORDER_DELIVERY" ||
    isXExpressCashOnDelivery(args.paymentMethod) ||
    args.paymentStatuses.some((status) =>
      SUCCESSFUL_PAYMENT_STATUSES.includes(status),
    )
  );
}
