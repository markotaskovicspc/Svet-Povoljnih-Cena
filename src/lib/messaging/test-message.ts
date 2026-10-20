import { z } from "zod";
/** Validate the current composer content without requiring a saved campaign. */
export function parseSingleTest(form: FormData) {
  const channel = form.get("channel") === "SMS" ? "SMS" : "VIBER";
  const parsed = z.object({
    body: z.string().trim().min(1),
    imageUrl: z.url().nullish(),
    ctaLabel: z.string().min(1).max(30).nullish(),
    ctaUrl: z.url().nullish(),
  }).parse({ body: String(form.get("body") ?? ""), imageUrl: String(form.get("imageUrl") ?? "") || null, ctaLabel: String(form.get("ctaLabel") ?? "") || null, ctaUrl: String(form.get("ctaUrl") ?? "") || null });
  if (channel === "SMS" && (parsed.imageUrl || parsed.ctaLabel || parsed.ctaUrl)) throw new Error("SMS podržava samo tekst.");
  if (channel === "VIBER" && parsed.body.length > 1000) throw new Error("NTH Viber dozvoljava do 1000 znakova.");
  if (Boolean(parsed.ctaLabel) !== Boolean(parsed.ctaUrl) || (parsed.imageUrl && !parsed.ctaUrl)) throw new Error("Uz sliku dodajte dugme sa tekstom i linkom.");
  if ([parsed.imageUrl, parsed.ctaUrl].some(url => url && !/^https?:\/\//.test(url))) throw new Error("Koristite http:// ili https:// link.");
  return parsed;
}
