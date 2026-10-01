import { z } from "zod";

export const EXIT_INTENT_CAMPAIGN = "first-purchase-exit-v1";
export const EXIT_INTENT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;
export const EXIT_INTENT_ARM_MS = 15_000;
export const EXIT_INTENT_RETAIN_MS = 30_000;
export const EXIT_INTENT_RETENTION_WINDOW_MS = 30 * 60 * 1_000;
export const exitIntentMetadataSchema = z.object({
  campaign: z.literal(EXIT_INTENT_CAMPAIGN),
  exposureId: z.uuid(),
  event: z.enum(["impression", "register_clicked", "login_clicked", "shop_clicked", "dismissed", "retained"]),
  discountPct: z.number().int().min(1).max(100),
  audience: z.enum(["guest", "customer"]),
}).strict();
export type ExitIntentMetadata = z.infer<typeof exitIntentMetadataSchema>;
export type ExitIntentEvent = ExitIntentMetadata["event"];

export function exitIntentEventId(metadata: ExitIntentMetadata) {
  return `xi:${metadata.exposureId}:${metadata.event}`;
}

export function exitIntentPathAllowed(path: string) {
  return !/^\/(admin|nalog|checkout|api|loyalty|placanje)(\/|$)/.test(path);
}

export function isTopExit(input: {
  clientY: number; relatedTarget: unknown; pointerUsed: boolean;
  visible: boolean; desktop: boolean; elapsedMs: number; closedUntil: number; now: number;
}) {
  return input.clientY <= 0 && input.relatedTarget == null && input.pointerUsed &&
    input.visible && input.desktop && input.elapsedMs >= EXIT_INTENT_ARM_MS &&
    input.closedUntil <= input.now;
}
