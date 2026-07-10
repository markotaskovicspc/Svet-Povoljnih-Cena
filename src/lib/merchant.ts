import { BRAND } from "@/lib/brand";

// NEEDS-USER: `pib` below is a placeholder — the real PIB (poreski
// identifikacioni broj) has not been provided. Replace before go-live; it
// appears on fiscal receipts, order confirmation emails, and legal pages.
export const MERCHANT_LEGAL_INFO = {
  name: BRAND.legalName,
  address: "Vojvođanska 401, 11000 Beograd, Republika Srbija",
  shortAddress: "Vojvođanska 401, 11000 Beograd",
  pib: "100000000",
  registrationNumber: "22112597",
  activityCode: "4791",
  activityName: "Trgovina na malo posredstvom pošte ili interneta",
  email: "podrska@svetpovoljnihcena.rs",
  phone: "+381 11 4444 555",
  bankAccount: "160-000000-00",
  bankName: "Banca Intesa",
  pdvNote: "PDV je uključen u cenu.",
} as const;
