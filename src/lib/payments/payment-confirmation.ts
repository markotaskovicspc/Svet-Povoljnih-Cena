import { z } from "zod";
import { bankEntrySchema } from "./bank-statements";

export const manualPaymentConfirmationSchema = z.object({
  source: z.literal("MANUAL"),
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  orderNumber: z.string().min(1).max(100),
  amountMinor: z.number().int().positive().max(999999999999),
  currency: z.enum(["RSD", "EUR", "USD"]),
});

// Existing bank jobs keep their payload and receipt identity unchanged.
export const paymentConfirmationSchema = z.union([
  bankEntrySchema.extend({ orderId: z.string().min(1) }),
  manualPaymentConfirmationSchema,
]);

export type PaymentConfirmation = z.infer<typeof paymentConfirmationSchema>;
