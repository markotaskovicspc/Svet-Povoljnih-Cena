/** PU, Obaveze obveznika fiskalizacije (February 2026), printed page 31.
 * Identification is required for cash paid back in person. A bank/card return
 * must not be blocked on collecting a natural person's identity document.
 */
export function refundNeedsBuyerId(method: string) {
  return method === "POUZECE_GOTOVINA" || method === "CASH";
}

export function validateRefundBuyerId(method: string, buyerId?: string | null) {
  const value = buyerId?.trim();
  if (!value && !refundNeedsBuyerId(method)) return null;
  if (!value) return "Za gotovinski povraćaj na licu mesta unesite identifikacioni dokument kupca (20:broj lične karte ili 23:broj pasoša).";
  if (!/^\d{1,2}:\S+$/.test(value)) return "Identifikacija kupca mora biti u formatu 10:PIB ili 20:broj lične karte.";
  return null;
}
