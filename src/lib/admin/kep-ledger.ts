export type KepFiscalKind = "SALE" | "REFUND";

export function receiptAccountingDate(input: {
  receiptDate: Date | null;
  snapshotBookedAt: Date | null;
  postedAt: Date | null;
}) {
  return input.receiptDate ?? input.snapshotBookedAt ?? input.postedAt;
}

export function dispatchAccountingDate(input: {
  actualDispatchAt: Date | null;
  issueDate: Date | null;
  snapshotBookedAt: Date | null;
  postedAt: Date | null;
}) {
  return input.actualDispatchAt ?? input.issueDate ?? input.snapshotBookedAt ?? input.postedAt;
}

export function isAnanasName(value: string | null | undefined) {
  return Boolean(value && /\bananas\b/i.test(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  ));
}

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
