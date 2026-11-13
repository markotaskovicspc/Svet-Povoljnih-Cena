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

function orderViberEnabled() {
  const cfg = getViberConfig();
  return isProviderAccepted("VIBER_ORDER_NOTIFICATIONS_ENABLED") && isViberReady() && cfg.provider === "nth" && cfg.deliveryMode === "worker";
}

async function loadOrderForViber(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { number: true, shipPhone: true, status: true, guestEmail: true, user: { select: { email: true } } },
  });
  if (!order?.shipPhone) return null;
  // Buyers with an email already receive the receipt and status emails. Viber is
  // the fallback channel for orders without any email, unless explicitly widened.
  if (envValue("VIBER_ORDER_NOTIFICATIONS_SCOPE") !== "all" && hasOrderEmail(order)) return null;
  return order;
}

async function documentsLink(orderNumber: string) {
  const { orderDocumentsUrl } = await import("@/lib/orders/customer-documents");
  return orderDocumentsUrl(orderNumber);
}

export async function queueOrderViberNotification(orderId: string, event: "confirmation" | "status", status?: OrderStatus) {
  if (!orderViberEnabled()) return;
  // The confirmation prefers the approved template that links the documents page
  // (withdrawal form and guarantee); the plain template remains the fallback.
  const docsTemplateId = event === "confirmation" ? envValue("NTH_ORDER_CONFIRMATION_DOCS_TEMPLATE_ID") : null;
  const templateId = docsTemplateId || envValue(event === "confirmation" ? "NTH_ORDER_CONFIRMATION_TEMPLATE_ID" : "NTH_ORDER_STATUS_TEMPLATE_ID");
  if (!templateId) return; // Enable each template only after provider approval.
  const order = await loadOrderForViber(orderId);
  if (!order) return;
  const effectiveStatus = status ?? order.status;
  const parameters: Record<string, string> = event === "status"
    ? { order_number: order.number, status: labels[effectiveStatus] }
    : docsTemplateId
      ? { order_number: order.number, link: await documentsLink(order.number) }
      : { order_number: order.number };
  const result = await queueNthMessage({
    to: order.shipPhone!, text: "", kind: "transaction",
    requestId: `order:${orderId}:${event}:${event === "status" ? effectiveStatus : "received"}`,
    template: { id: templateId, lang: "sr", parameters },
  }, getViberConfig());
  if (!result.ok) throw new Error(result.error);
}

/** Fiscal receipt notice for buyers without e-mail: link to the documents page. */
export async function queueFiscalReceiptViber(orderId: string) {
  if (!orderViberEnabled()) return false;
  const templateId = envValue("NTH_FISCAL_RECEIPT_TEMPLATE_ID");
  if (!templateId) return false;
  const order = await loadOrderForViber(orderId);
  if (!order) return false;
  const result = await queueNthMessage({
    to: order.shipPhone!, text: "", kind: "transaction",
    requestId: `order:${orderId}:fiscal-receipt`,
    template: { id: templateId, lang: "sr", parameters: { order_number: order.number, link: await documentsLink(order.number) } },
  }, getViberConfig());
  return result.ok;
}

export function hasOrderEmail(order: { guestEmail?: string | null; user?: { email?: string | null } | null }) {
  return Boolean(order.guestEmail?.trim() || order.user?.email?.trim());
}
