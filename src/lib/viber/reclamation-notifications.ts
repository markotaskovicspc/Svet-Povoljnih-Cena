import "server-only";

import type { ReclamationResolution, ReclamationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { isProviderAccepted } from "@/lib/provider-acceptance";
import { getViberConfig, isViberReady } from "./config";
import { nthPhoneNumber } from "./nth";
import { queueNthMessage } from "./outbox";

/**
 * Customer reclamation notices for buyers WITHOUT any e-mail go to Viber
 * (approved NTH transactional templates). Buyers with an e-mail keep the
 * existing e-mails; Viber is never sent to them.
 */

export type ReclamationViberEvent =
  | { kind: "RECEIPT"; reclamationId: string }
  | { kind: "ACCEPTED"; reclamationId: string }
  | { kind: "STATUS"; reclamationId: string; eventKey?: string };

/**
 * legacy: Viber switch off, unchanged e-mail flow.
 * email: buyer has an e-mail; send the e-mail to `to`.
 * queued: buyer has no e-mail; Viber queued.
 * none: buyer has no e-mail and cannot be reached on Viber.
 */
export type ReclamationChannel =
  | { channel: "legacy" }
  | { channel: "email"; to: string }
  | { channel: "queued" }
  | { channel: "none" };

const TEMPLATE_ENV: Record<ReclamationViberEvent["kind"], string> = {
  RECEIPT: "NTH_RECLAMATION_RECEIPT_TEMPLATE_ID",
  ACCEPTED: "NTH_RECLAMATION_ACCEPTED_TEMPLATE_ID",
  STATUS: "NTH_RECLAMATION_STATUS_TEMPLATE_ID",
};

export const RECLAMATION_STATUS_LABELS: Record<ReclamationStatus, string> = {
  PRIMLJENO: "primljena", U_OBRADI: "u obradi", RESENO: "rešena", ODBIJENO: "odbijena",
};

export const RECLAMATION_RESOLUTION_LABELS: Record<ReclamationResolution, string> = {
  POVRAT_NOVCA: "povraćaj novca", ZAMENA_ARTIKLA: "zamena artikla",
  ZAMENA_DELA: "zamena dela", POPUST: "umanjenje cene",
};

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

export async function resolveReclamationChannel(event: ReclamationViberEvent): Promise<ReclamationChannel> {
  if (!isReclamationViberEnabled()) return { channel: "legacy" };
  const claim = await db.reclamation.findUnique({
    where: { id: event.reclamationId },
    select: {
      number: true, status: true, resolution: true, customerEmail: true, customerPhone: true,
      order: { select: { number: true, shipPhone: true, guestEmail: true, user: { select: { email: true } } } },
    },
  });
  if (!claim) return { channel: "none" };
  const email = [claim.customerEmail, claim.order.guestEmail, claim.order.user?.email].map(v => v?.trim()).find(Boolean);
  if (email) return { channel: "email", to: email };

  const templateId = envValue(TEMPLATE_ENV[event.kind]);
  const phone = validPhone(claim.customerPhone, claim.order.shipPhone);
  if (!templateId || !phone) return { channel: "none" };

  let parameters: Record<string, string>;
  let requestId: string;
  if (event.kind === "RECEIPT") {
    parameters = { reclamation_number: claim.number };
    requestId = `reclamation:${event.reclamationId}:receipt`;
  } else if (event.kind === "ACCEPTED") {
    if (!claim.resolution) return { channel: "none" };
    parameters = { reclamation_number: claim.number, resolution: RECLAMATION_RESOLUTION_LABELS[claim.resolution] };
    requestId = `reclamation:${event.reclamationId}:accepted:${claim.resolution}`;
  } else {
    parameters = { reclamation_number: claim.number, status: RECLAMATION_STATUS_LABELS[claim.status] };
    requestId = `reclamation:${event.reclamationId}:status:${event.eventKey ?? claim.status}`;
  }

  const result = await queueNthMessage({
    to: phone, text: "", kind: "transaction", requestId,
    template: { id: templateId, lang: "sr", parameters },
  }, getViberConfig());
  return result.ok ? { channel: "queued" } : { channel: "none" };
}
