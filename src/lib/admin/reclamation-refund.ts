import { z } from "zod";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";

const planLine = z.object({ id: z.string(), qty: z.number().int().positive() });
export const reclamationPayoutPlanSchema = z.object({
  reclamationId: z.string(), bankAccount: z.string().optional(), quantity: z.number().int().positive(),
  lines: z.array(planLine).min(1), confirmedPaidBy: z.string().optional(),
  paymentEvidence: z.object({ source: z.enum(["PAYMENT", "COD_DELIVERY", "COURIER_REMITTANCE"]), ids: z.array(z.string()) }).optional(),
});
export type ReclamationPayoutPlan = z.infer<typeof reclamationPayoutPlanSchema>;

export function readReclamationPayoutPlan(value: unknown) {
  const parsed = reclamationPayoutPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Buyer collection and the courier's later remittance are separate events. */
export function originalPaymentEvidence(order: {
  paymentMethod: string; total: unknown; courierPaidAt?: Date | null;
  payments: { id: string; status: string; amount: unknown }[];
  shipments: { id: string; purpose: string; status: string; deliveredAt: Date | null; provider: string | null; codAmount: unknown; rawCreateResponse: unknown; syncError?: string | null }[];
}) {
  const total = Math.round(Number(order.total) * 100);
  if (!Number.isFinite(total) || total <= 0) return null;
  const payments = order.payments.filter(row => ["PAID", "PARTIAL_REFUND", "REFUNDED"].includes(row.status) && Number(row.amount) > 0);
  if (payments.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) >= total) {
    return { source: "PAYMENT" as const, ids: payments.map(row => row.id) };
  }
  if (!["POUZECE_GOTOVINA", "POUZECE_KARTICA"].includes(order.paymentMethod)) return null;
  if (order.courierPaidAt) return { source: "COURIER_REMITTANCE" as const, ids: [] };
  const shipments = order.shipments.filter(row => row.purpose === "ORDER_DELIVERY" && row.status === "DELIVERED" && row.deliveredAt && row.provider && row.syncError !== "MyGLS etiketa obrisana.");
  const collected = shipments.reduce((sum, row) => {
    const amount = row.codAmount ?? readShipmentAssignment(row.rawCreateResponse)?.codAmount;
    return sum + (Number.isFinite(Number(amount)) && Number(amount) > 0 ? Math.round(Number(amount) * 100) : 0);
  }, 0);
  // A delivery status alone, a zero-COD replacement or an unmatched amount is insufficient.
  return collected === total ? { source: "COD_DELIVERY" as const, ids: shipments.map(row => row.id) } : null;
}

export function allocateClaimRefund(lines: { id: string; qty: number; refundedQty: number; unitPriceGross: unknown }[], quantity: number, reserved: Map<string, number> = new Map()) {
  let remaining = quantity;
  let cents = 0;
  const selected: { id: string; qty: number }[] = [];
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Količina reklamacije nije ispravna.");
  for (const line of lines) {
    const qty = Math.min(remaining, Math.max(0, line.qty - line.refundedQty - (reserved.get(line.id) ?? 0)));
    if (!qty) continue;
    selected.push({ id: line.id, qty });
    cents += Math.round(Number(line.unitPriceGross) * 100) * qty;
    remaining -= qty;
    if (!remaining) break;
  }
  if (remaining) throw new Error("Nema dovoljno nerefundiranih komada na originalnim fiskalnim računima. Proverite ostale reklamacije i već pripremljene povrate.");
  return { lines: selected, amount: cents / 100 };
}

/** A pending payment alone is inconclusive: require an undelivered courier return. */
export function isUnpaidCodReturn(order: {
  paymentMethod: string; courierPaidAt: Date | null;
  payments: { status: string }[];
  shipments: { purpose: string; status: string; deliveredAt: Date | null }[];
}) {
  if (!["POUZECE_GOTOVINA", "POUZECE_KARTICA"].includes(order.paymentMethod) || order.courierPaidAt ||
    order.payments.some(row => ["PAID", "PARTIAL_REFUND", "REFUNDED"].includes(row.status))) return false;
  const deliveries = order.shipments.filter(row => row.purpose === "ORDER_DELIVERY");
  return deliveries.some(row => row.status === "RETURNED") && deliveries.every(row => !row.deliveredAt && ["RETURNED", "FAILED"].includes(row.status));
}
