/** Broj računa i procenat umanjenja koje kupac upisuje uz reklamaciju (Marko, 13.11.2026). */
export const REFUND_ACCOUNT_REQUESTS = ["POVRACAJ_NOVCA", "ODUSTANAK", "UMANJENJE_CENE"] as const;

export function needsRefundAccount(request: string | null | undefined) {
  return (REFUND_ACCOUNT_REQUESTS as readonly string[]).includes(request ?? "");
}

export function needsDiscountPct(request: string | null | undefined) {
  return request === "UMANJENJE_CENE";
}

/** 18 cifara bez crtica; prihvata i zapis 160-0000000000000-00 (srednji deo se dopunjava nulama). */
export function normalizeRefundAccount(value: string): string | null {
  const text = value.trim().replace(/\s+/g, "");
  const parts = /^(\d{3})-(\d{1,13})-(\d{2})$/.exec(text);
  const digits = parts ? parts[1] + parts[2].padStart(13, "0") + parts[3] : text.replace(/-/g, "");
  if (!/^\d{18}$/.test(digits)) return null;
  // Kontrolni broj po MOD 97 (ISO 7064), kao na srpskim tekućim računima.
  if (BigInt(digits) % BigInt(97) !== BigInt(1)) return null;
  return digits;
}

export function formatRefundAccount(digits: string) {
  return digits.length === 18 ? `${digits.slice(0, 3)}-${digits.slice(3, 16)}-${digits.slice(16)}` : digits;
}
