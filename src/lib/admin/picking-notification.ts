import { z } from "zod";

export const pickingNotificationSchema = z.object({
  mode: z.enum(["labels", "shortage"]), batchId: z.string().min(1), batchNumber: z.string().min(1),
  planHash: z.string().length(64), operationKey: z.string().length(64),
  shortages: z.array(z.object({ sku: z.string(), name: z.string(), required: z.number().int().positive(),
    picked: z.number().int().nonnegative(), missing: z.number().int().positive(),
    orders: z.array(z.object({ number: z.string(), quantity: z.number().int().positive() })) })),
});
export type PickingNotification = z.infer<typeof pickingNotificationSchema>;
