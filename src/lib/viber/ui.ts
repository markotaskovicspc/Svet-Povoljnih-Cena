import { parseBelgradePricingDate } from "@/lib/admin/pricing-date-time";
import { z } from "zod";

export const audienceFormSchema = z.object({
  channel: z.enum(["VIBER", "SMS"]).default("VIBER"),
  name: z.string().trim().min(1).max(120),
  cities: z.string().max(1000).default(""),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
  everyone: z.boolean().default(true),
  allStoredPhones: z.boolean().default(false),
}).refine((v) => !v.from || !v.to || v.from <= v.to, { message: "Datum početka mora biti pre datuma završetka." });

export function audienceFormFilter(input: z.input<typeof audienceFormSchema>) {
  const v = audienceFormSchema.parse(input);
  if (v.allStoredPhones) return { allStoredPhones: true, phoneScope: "current" as const, channel: v.channel };
  const cities = [...new Set(v.cities.split(",").map((s) => s.trim()).filter(Boolean))];
  if (cities.length > 50) throw new Error("Izaberite najviše 50 gradova.");
  return {
    ...(v.channel === "SMS" ? { channel: v.channel } : {}),
    ...(cities.length ? { cities } : {}),
    ...(v.from ? { lastPurchaseFrom: parseBelgradePricingDate(v.from, "start")!.toISOString() } : {}),
    ...(v.to ? { lastPurchaseTo: parseBelgradePricingDate(v.to, "end")!.toISOString() } : {}),
    includeNonCustomers: v.everyone && !cities.length && !v.from && !v.to,
  };
}

export function audienceDescription(filter: unknown) {
  const f = (filter ?? {}) as { importedContacts?: unknown[]; cities?: string[]; lastPurchaseFrom?: string; lastPurchaseTo?: string; includeNonCustomers?: boolean; allStoredPhones?: boolean; phoneScope?: string; channel?: string };
  if (f.importedContacts) return `Excel / CSV lista · ${f.importedContacts.length.toLocaleString("sr-RS")} brojeva${f.allStoredPhones ? " + postojeći kupci" : ""} · bez evidentiranih odjava`;
  if (f.allStoredPhones) return f.phoneScope === "current" ? "Svi kupci i kontakti sa važećim brojem · bez evidentiranih odjava" : "Svi brojevi telefona · potvrđena saglasnost 14.10.2026.";
  return [f.includeNonCustomers ? "Svi brojevi telefona sa Viber saglasnošću" : "Kupci sa završenom kupovinom i Viber saglasnošću", f.cities?.length ? f.cities.join(", ") : "", f.lastPurchaseFrom || f.lastPurchaseTo ? "Odabrani period kupovine" : ""].filter(Boolean).join(" · ").replaceAll("Viber", f.channel === "SMS" ? "SMS" : "Viber");
}

export const messageStatusLabel: Record<string, string> = {
  VIBER_QUEUED: "Čeka slanje", VIBER_RUNNING: "Slanje u toku", VIBER_SENT: "Prihvaćena, čeka isporuku",
  VIBER_DELIVERED: "Isporučena", VIBER_SEEN: "Pročitana", VIBER_FAILED: "Neuspešna", VIBER_UNKNOWN: "Potrebna provera", VIBER_CANCELLED: "Otkazana",
};
export const campaignStatusLabel: Record<string, string> = { DRAFT: "Nacrt", SCHEDULED: "Zakazana", SENDING: "Slanje u toku", SENT: "Predato za slanje", FAILED: "Neuspešna" };
