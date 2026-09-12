import { z } from "zod";

export const AR_EXPERIMENT = "ar-copy-v2";
export const AR_EXPERIMENTS = {
  "ar-copy-v1": { A: "Vidi u svojoj sobi", B: "Proveri kako se uklapa" },
  "ar-copy-v2": { A: "Pogledaj u svojoj sobi", B: "Isprobaj u svojoj sobi" },
} as const;
export const AR_COPY = AR_EXPERIMENTS[AR_EXPERIMENT];
export const AR_EVENTS = ["controls_viewed", "model_requested", "model_opened", "model_used", "model_failed", "ar_clicked", "ar_attempted", "ar_qr_opened", "ar_qr_landed", "ar_failed"] as const;
export type ProductArEvent = typeof AR_EVENTS[number];
export const productArMetadataSchema = z.object({
  event: z.enum(AR_EVENTS),
  eventId: z.string().uuid(),
  slug: z.string().min(1).max(100),
  experiment: z.enum(["ar-copy-v1", "ar-copy-v2"]),
  variant: z.enum(["A", "B"]),
  device: z.enum(["desktop", "android", "ios"]),
  surface: z.enum(["photo", "viewer", "fullscreen", "ar_cta", "qr"]),
  source: z.string().max(120),
  medium: z.string().max(120),
  campaign: z.string().max(120),
  content: z.string().max(120),
}).strict();
export type ProductArMetadata = z.infer<typeof productArMetadataSchema>;
