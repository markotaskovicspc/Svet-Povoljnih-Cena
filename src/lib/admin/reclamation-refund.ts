import { z } from "zod";

const planLine = z.object({ id: z.string(), qty: z.number().int().positive() });
export const reclamationPayoutPlanSchema = z.object({
  reclamationId: z.string(), bankAccount: z.string(), quantity: z.number().int().positive(),
  lines: z.array(planLine).min(1), confirmedPaidBy: z.string(),
});
export type ReclamationPayoutPlan = z.infer<typeof reclamationPayoutPlanSchema>;

export function readReclamationPayoutPlan(value: unknown) {
  const parsed = reclamationPayoutPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Serbian domestic account, with leading zeros restored for printed 3-N-2 notation. */
export function normalizeRefundBankAccount(value: string) {
  const input = value.trim();
  const formatted = input.match(/^(\d{3})-(\d{1,13})-(\d{2})$/);
  const digits = formatted ? formatted[1] + formatted[2]!.padStart(13, "0") + formatted[3] : input.replace(/\s/g, "");
  if (!/^\d{18}$/.test(digits) || BigInt(digits) % BigInt(97) !== BigInt(1)) {
    throw new Error("Unesite ispravan domaći račun kupca (18 cifara ili format 3-broj-2). Proverite kontrolni broj.");
  }
  return digits;
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
