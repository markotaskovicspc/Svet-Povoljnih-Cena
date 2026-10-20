import { z } from "zod";

export const ANANAS_RETURN_STATUSES = ["RETURN_TO_SELLER", "RETURNED_TO_SELLER"] as const;
const returnShipment = z.object({
  suborderId: z.string().min(1), status: z.enum(ANANAS_RETURN_STATUSES),
  carrierName: z.string().nullish(), quantity: z.number().int().nonnegative(),
});
/** A suborder ID is Ananas's shipment reference, not a return tracking number. */
export function ananasReturnShipments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(row => {
    const parsed = returnShipment.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
