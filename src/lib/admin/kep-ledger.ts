export type KepFiscalKind = "SALE" | "REFUND";

export function roundKepMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sale discounts reduce the retail book value; refunds restore the discount. */
export function fiscalLevelingDifference(input: {
  kind: KepFiscalKind;
  qty: number;
  fullMpc: number;
  actualMpc: number;
}) {
  const difference = input.kind === "SALE"
    ? (input.actualMpc - input.fullMpc) * input.qty
    : (input.fullMpc - input.actualMpc) * input.qty;
  return roundKepMoney(difference);
}

export function priceChangeLevelingDifference(input: {
  qtyAtChange: number;
  previousMpc: number;
  nextMpc: number;
}) {
  return roundKepMoney((input.nextMpc - input.previousMpc) * input.qtyAtChange);
}
