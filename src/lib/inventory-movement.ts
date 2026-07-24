import type { StockMovementKind } from "@prisma/client";

export const STOCK_MOVEMENT_KIND_LABELS = {
  SALE_RESERVATION: "Fiskalizacija / prodaja",
  REFUND_RETURN: "Povrat po fiskalizaciji",
  ADJUSTMENT: "Ručna korekcija",
  OPENING_BALANCE: "Početno stanje",
  PURCHASE_RECEIPT: "Prijem robe",
  DISPATCH: "Eksterna otpremnica",
  INTERNAL_TRANSFER_OUT: "Interna otpremnica — izlaz",
  INTERNAL_TRANSFER_IN: "Interna otpremnica — ulaz",
  STOCK_COUNT: "Manjak / višak po popisu",
  PARTNER_RESERVATION: "Partnerska rezervacija",
} as const satisfies Record<StockMovementKind, string>;

export function stockMovementKindLabel(kind: StockMovementKind) {
  return STOCK_MOVEMENT_KIND_LABELS[kind];
}
