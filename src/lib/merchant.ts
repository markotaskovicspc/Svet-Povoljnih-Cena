import { BRAND } from "@/lib/brand";

function publicValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && !normalized.startsWith("GET_FROM_") ? normalized : null;
}

export const MERCHANT_LEGAL_INFO = {
  name: BRAND.legalName,
  address: "Vojvođanska 401, 11000 Beograd, Republika Srbija",
  shortAddress: "Vojvođanska 401, 11000 Beograd",
  pib: "115085587",
  registrationNumber: "22112597",
  activityCode: "4791",
  activityName: "Trgovina na malo posredstvom pošte ili interneta",
  email: "podrska@svetpovoljnihcena.rs",
  phone: publicValue(process.env.NEXT_PUBLIC_MERCHANT_PHONE),
  viber: publicValue(process.env.NEXT_PUBLIC_MERCHANT_VIBER),
  warehouseAddress: publicValue(process.env.NEXT_PUBLIC_MERCHANT_WAREHOUSE_ADDRESS),
  returnsAddress: publicValue(process.env.NEXT_PUBLIC_MERCHANT_RETURNS_ADDRESS),
  supportHours: publicValue(process.env.NEXT_PUBLIC_MERCHANT_SUPPORT_HOURS),
  bankAccount: "265-3310310005375-34",
  bankName: "Raiffeisen banka",
  pdvNote: "PDV je uključen u cenu.",
} as const;
