import "server-only";
import { db } from "@/lib/db";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { loadOrderForEmail } from "./adapt";
import { getEmailConfig } from "./config";
import { orderLinkForEmail } from "./order-link";
import { trackedDispatch } from "./tracking";
import { unpaidTransferDeadline, unpaidTransferReminderKey } from "@/lib/orders/unpaid-transfer";

const money = (amount: number) =>
  new Intl.NumberFormat("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " din";
const dateSr = (d: Date) => d.toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" });
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export async function sendUnpaidTransferReminder(orderId: string) {
  const loaded = await loadOrderForEmail(orderId);
  if (!loaded) throw new Error("UNPAID_TRANSFER_ORDER_NOT_FOUND");
  if (!loaded.recipient) return { skipped: "NO_CUSTOMER_EMAIL" as const };
  const row = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { createdAt: true } });
  // Prikazujemo dan pre trenutka otkazivanja, jer izvod stiže narednog dana.
  const deadline = new Date(unpaidTransferDeadline(row.createdAt, new Date()).getTime() - 24 * 60 * 60 * 1000);
  const orderUrl = await orderLinkForEmail(orderId, loaded.order, getEmailConfig().baseUrl);
  const name = loaded.order.shippingAddress?.firstName?.trim();
  const text = [
    name ? `Poštovani/a ${name},` : "Poštovani/a,",
    `porudžbina ${loaded.order.id} čeka uplatu po predračunu. Uplatu još nismo evidentirali.`,
    `Iznos: ${money(loaded.order.total)}\nRačun: ${MERCHANT_LEGAL_INFO.bankAccount} (${MERCHANT_LEGAL_INFO.bankName})\nPoziv na broj: ${loaded.order.id}`,
    `Ako uplata ne bude izvršena najkasnije ${dateSr(deadline)}, porudžbina će biti automatski otkazana.`,
    "Ako ste uplatu već izvršili, ne morate ništa da radite — evidentiraćemo je čim stigne bankarski izvod, a potvrdu ćete dobiti mejlom.",
    orderUrl ? `Pregled porudžbine i predračun: ${orderUrl}` : null,
    "Svet povoljnih cena",
  ].filter(Boolean).join("\n\n");
  return trackedDispatch({
    kind: "unpaid_transfer_reminder",
    to: loaded.recipient,
    subject: `Podsetnik za uplatu — ${loaded.order.id}`,
    text,
    html: `<div style="font-family:Arial,sans-serif;white-space:pre-line">${escape(text)}</div>`,
    idempotencyKey: unpaidTransferReminderKey(orderId),
    tags: { kind: "unpaid_transfer_reminder", order: loaded.order.id },
  });
}
