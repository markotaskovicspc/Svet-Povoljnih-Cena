/** Broj računa i procenat umanjenja koje kupac upisuje uz reklamaciju (Marko, 13.11.2026). */
export const REFUND_ACCOUNT_REQUESTS = ["POVRACAJ_NOVCA", "ODUSTANAK", "UMANJENJE_CENE"] as const;
export const MAX_DISCOUNT_PCT = 70;

export function needsRefundAccount(request: string | null | undefined) {
  return (REFUND_ACCOUNT_REQUESTS as readonly string[]).includes(request ?? "");
}

export function needsDiscountPct(request: string | null | undefined) {
  return request === "UMANJENJE_CENE";
}

/** Broj računa se ne proverava (Marko, 13.11.2026); samo se uklanjaju suvišni razmaci. */
export function cleanRefundAccount(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 40) : null;
}

export function isValidDiscountPct(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DISCOUNT_PCT;
}

export function formatRefundAccount(value: string) {
  return /^\d{18}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3, 16)}-${value.slice(16)}` : value;
}
