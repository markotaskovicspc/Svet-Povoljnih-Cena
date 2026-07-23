export const SUPPLIER_PARITY_OPTIONS = [
  "EXW",
  "FCA",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
] as const;

export function formatSupplierCode(serial: number) {
  if (!Number.isSafeInteger(serial) || serial < 1) {
    throw new Error("Redni broj dobavljača mora biti pozitivan ceo broj.");
  }
  return `DOB-${String(serial).padStart(4, "0")}`;
}
