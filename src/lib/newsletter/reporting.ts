import type { NewsletterCampaignStatus } from "@prisma/client";

export const newsletterCampaignLabels: Record<NewsletterCampaignStatus, string> = {
  DRAFT: "Nacrt",
  IN_REVIEW: "Spremna za slanje",
  APPROVED: "Odobrena",
  SCHEDULED: "Zakazana",
  PREPARING: "Priprema primalaca",
  SENDING: "Slanje u toku",
  SENT: "Slanje završeno",
  CANCELLED: "Otkazana",
  PARTIAL_FAILED: "Delimična greška",
  FAILED: "Greška slanja",
};

export function newsletterCount(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("sr-Latn-RS");
}

export function newsletterRate(value: number | null | undefined, delivered: number | null | undefined) {
  if (value == null || delivered == null || delivered <= 0) return "—";
  return `${((value / delivered) * 100).toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export const newsletterMetricExplanation = "Open rate = primaoci sa evidentiranim otvaranjem ÷ isporučene poruke. CTR = primaoci koji su kliknuli ÷ isporučene poruke. Svaki primalac se broji jednom po kampanji. Crtica znači da još nema dovoljno podataka za procenat.";
