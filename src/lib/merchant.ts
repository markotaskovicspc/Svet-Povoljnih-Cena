import { BRAND } from "@/lib/brand";

export const MERCHANT_LEGAL_INFO = {
  name: BRAND.legalName,
  address: "Vojvođanska 401, 11000 Beograd, Republika Srbija",
  shortAddress: "Vojvođanska 401, 11000 Beograd",
  pib: "115085587",
  registrationNumber: "22112597",
  activityCode: "4791",
  activityName: "Trgovina na malo posredstvom pošte ili interneta",
  email: "podrska@svetpovoljnihcena.rs",
  phone: "+381 11 4444 555",
  bankAccount: "265-3310310005375-34",
  bankName: "Raiffeisen banka",
  pdvNote: "PDV je uključen u cenu.",
} as const;
