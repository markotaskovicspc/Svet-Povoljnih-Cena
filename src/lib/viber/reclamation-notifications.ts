import "server-only";

import type { ReclamationResolution, ReclamationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { isProviderAccepted } from "@/lib/provider-acceptance";
import { getViberConfig, isViberReady } from "./config";
import { nthPhoneNumber } from "./nth";
import { queueNthMessage } from "./outbox";

/**
 * Customer reclamation notices go to Viber first (approved NTH transactional
 * templates). E-mail is only the fallback: when Viber is unavailable for the
 * claim (no valid phone, template missing) or the NTH worker later reports the
 * message as failed/unknown. The fallback is driven by the NTH requestId, so no
 * customer data has to be added to the provider payload.
 */

export type ReclamationViberEvent =
  | { kind: "RECEIPT"; reclamationId: string }
  | { kind: "ACCEPTED"; reclamationId: string }
  | { kind: "STATUS"; reclamationId: string; eventKey?: string }
  | { kind: "LINK"; orderId: string; accessToken: string };

/** queued: Viber owns delivery. unavailable: Viber is on but cannot reach this buyer. disabled: legacy e-mail flow. */
export type ReclamationViberOutcome = "queued" | "unavailable" | "disabled";

const TEMPLATE_ENV: Record<ReclamationViberEvent["kind"], string> = {
  RECEIPT: "NTH_RECLAMATION_RECEIPT_TEMPLATE_ID",
  ACCEPTED: "NTH_RECLAMATION_ACCEPTED_TEMPLATE_ID",
  STATUS: "NTH_RECLAMATION_STATUS_TEMPLATE_ID",
  LINK: "NTH_RECLAMATION_LINK_TEMPLATE_ID",
};

export const RECLAMATION_STATUS_LABELS: Record<ReclamationStatus, string> = {
  PRIMLJENO: "primljena", U_OBRADI: "u obradi", RESENO: "rešena", ODBIJENO: "odbijena",
};

export const RECLAMATION_RESOLUTION_LABELS: Record<ReclamationResolution, string> = {
  POVRAT_NOVCA: "povraćaj novca", ZAMENA_ARTIKLA: "zamena artikla",
  ZAMENA_DELA: "zamena dela", POPUST: "umanjenje cene",
};

export const RECLAMATION_FALLBACK_PREFIX = "rclfb:";

export function isReclamationViberEnabled() {
  const cfg = getViberConfig();
  return isProviderAccepted("VIBER_RECLAMATION_NOTIFICATIONS_ENABLED") && isViberReady()
    && cfg.provider === "nth" && cfg.deliveryMode === "worker";
}

function validPhone(...values: (string | null | undefined)[]) {
  for (const value of values) {
    if (!value) continue;
    try { return nthPhoneNumber(value); } catch { /* try next */ }
  }
  return null;
}

export async function queueReclamationViber(event: ReclamationViberEvent): Promise<ReclamationViberOutcome> {
  if (!isReclamationViberEnabled()) return "disabled";
  const templateId = envValue(TEMPLATE_ENV[event.kind]);
  if (!templateId) return "unavailable";

  let phone: string | null;
  let parameters: Record<string, string>;
  let requestId: string;

  if (event.kind === "LINK") {
    const order = await db.order.findUnique({ where: { id: event.orderId }, select: { number: true, shipPhone: true } });
    phone = validPhone(order?.shipPhone);
    if (!order || !phone) return "unavailable";
    const link = `${getViberConfig().baseUrl}/reklamacije/prijava?order=${encodeURIComponent(order.number)}&token=${encodeURIComponent(event.accessToken)}`;
    parameters = { order_number: order.number, link };
    requestId = `${RECLAMATION_FALLBACK_PREFIX}LINK:${event.orderId}:${event.accessToken}`;
  } else {
    const claim = await db.reclamation.findUnique({
      where: { id: event.reclamationId },
      select: { number: true, status: true, resolution: true, customerPhone: true, order: { select: { number: true, shipPhone: true } } },
    });
    phone = validPhone(claim?.customerPhone, claim?.order.shipPhone);
    if (!claim || !phone) return "unavailable";
    if (event.kind === "RECEIPT") {
      parameters = { reclamation_number: claim.number, order_number: claim.order.number };
      requestId = `${RECLAMATION_FALLBACK_PREFIX}RECEIPT:${event.reclamationId}`;
    } else if (event.kind === "ACCEPTED") {
      if (!claim.resolution) return "unavailable";
      parameters = { reclamation_number: claim.number, resolution: RECLAMATION_RESOLUTION_LABELS[claim.resolution] };
      requestId = `${RECLAMATION_FALLBACK_PREFIX}ACCEPTED:${event.reclamationId}:${claim.resolution}`;
    } else {
      parameters = { reclamation_number: claim.number, status: RECLAMATION_STATUS_LABELS[claim.status] };
      requestId = `${RECLAMATION_FALLBACK_PREFIX}STATUS:${event.reclamationId}:${event.eventKey ?? claim.status}`;
    }
  }

  const result = await queueNthMessage({
    to: phone, text: "", kind: "transaction", requestId,
    template: { id: templateId, lang: "sr", parameters },
  }, getViberConfig());
  // A previous attempt that failed or is ambiguous must not block the buyer: use e-mail.
  return result.ok ? "queued" : "unavailable";
}

/**
 * Called when an NTH job ends as failed/unknown. Re-queues the original
 * reclamation e-mail job with `viaEmail` so the buyer still gets the notice.
 */
export async function queueReclamationEmailFallback(requestId: unknown) {
  if (typeof requestId !== "string" || !requestId.startsWith(RECLAMATION_FALLBACK_PREFIX)) return false;
  const [kind, id, extra] = requestId.slice(RECLAMATION_FALLBACK_PREFIX.length).split(":");
  if (!id) return false;
  const { enqueueBackgroundJob } = await import("@/lib/background-jobs");
  const key = `${requestId.slice(0, 160)}:email`;
  switch (kind) {
    case "RECEIPT":
      await enqueueBackgroundJob({ kind: "RECLAMATION_RECEIPT", payload: { reclamationId: id, viaEmail: true }, idempotencyKey: key });
      return true;
    case "ACCEPTED":
      await enqueueBackgroundJob({ kind: "RECLAMATION_ACCEPTED_EMAIL", payload: { reclamationId: id, viaEmail: true }, idempotencyKey: key });
      return true;
    case "STATUS":
      await enqueueBackgroundJob({ kind: "RECLAMATION_STATUS_EMAIL", payload: { reclamationId: id, ...(extra ? { eventId: extra } : {}), viaEmail: true }, idempotencyKey: key });
      return true;
    case "LINK":
      if (!extra) return false;
      await enqueueBackgroundJob({ kind: "GUEST_RECLAMATION_LINK_EMAIL", payload: { orderId: id, accessToken: extra, viaEmail: true }, idempotencyKey: key });
      return true;
    default:
      return false;
  }
}
