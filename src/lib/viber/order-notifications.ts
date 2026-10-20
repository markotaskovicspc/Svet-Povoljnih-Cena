import "server-only";
import type { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { isProviderAccepted } from "@/lib/provider-acceptance";
import { getViberConfig, isViberReady } from "./config";
import { queueNthMessage } from "./outbox";

const labels: Record<OrderStatus, string> = {
  KREIRANO: "primljena", POTVRDJENO: "potvrđena", U_PRIPREMI: "u pripremi",
  SPREMNO_ZA_ISPORUKU: "spremna za isporuku", U_ISPORUCI: "u isporuci",
  ISPORUCENO: "isporučena", OTKAZANO: "otkazana", VRACENO: "vraćena",
};

export async function queueOrderViberNotification(orderId: string, event: "confirmation" | "status", status?: OrderStatus) {
  const cfg = getViberConfig();
  if (!isProviderAccepted("VIBER_ORDER_NOTIFICATIONS_ENABLED") || !isViberReady() || cfg.provider !== "nth" || cfg.deliveryMode !== "worker") return;
  const templateId = envValue(event === "confirmation" ? "NTH_ORDER_CONFIRMATION_TEMPLATE_ID" : "NTH_ORDER_STATUS_TEMPLATE_ID");
  if (!templateId) return; // Enable each template only after provider approval.
  const order = await db.order.findUnique({
    where: { id: orderId }, select: { number: true, shipPhone: true, status: true },
  });
  if (!order?.shipPhone) return;
  const effectiveStatus = status ?? order.status;
  const result = await queueNthMessage({
    to: order.shipPhone, text: "", kind: "transaction",
    requestId: `order:${orderId}:${event}:${event === "status" ? effectiveStatus : "received"}`,
    template: {
      id: templateId, lang: "sr",
      parameters: event === "confirmation" ? { order_number: order.number } : { order_number: order.number, status: labels[effectiveStatus] },
    },
  }, cfg);
  if (!result.ok) throw new Error(result.error);
}
