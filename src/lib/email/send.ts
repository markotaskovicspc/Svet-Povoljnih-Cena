import "server-only";

import type { Order, OrderStatus, Reclamation } from "@/types";
import { OrderConfirmation } from "./templates/order-confirmation";
import { OrderStatusChanged } from "./templates/order-status-changed";
import { FiscalReceiptEmail } from "./templates/fiscal-receipt";
import { ReclamationReceipt } from "./templates/reclamation-receipt";
import { PasswordReset } from "./templates/password-reset";
import { OtpEmail } from "./templates/otp";
import { renderEmail } from "./render";
import { dispatch, type DispatchResult, type EmailAttachment } from "./transport";
import { getEmailConfig } from "./config";
import { buildInvoicePdf, buildWithdrawalFormPdf } from "./pdf";

/**
 * Phase 4D — typed senders the rest of the codebase calls.
 *
 * Each function is fire-and-forget tolerant: callers usually wrap the call in
 * `void send…().catch(...)` so a transient provider error never aborts the
 * order/payment/courier transaction that triggered it. Errors are logged
 * inside `dispatch()`.
 */

const NULL: DispatchResult = { ok: true, id: "noop", provider: "none" };

export async function sendOrderConfirmation(args: {
  order: Order;
  to: string;
  attachInvoice?: boolean;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    OrderConfirmation({ order: args.order, baseUrl: cfg.baseUrl }),
  );

  const attachments: EmailAttachment[] = [];
  if (args.attachInvoice !== false) {
    const pdfOrder = orderToPdfInput(args.order);
    attachments.push({
      filename: `predracun-${args.order.id}.pdf`,
      content: buildInvoicePdf(pdfOrder).toString("base64"),
      contentType: "application/pdf",
    });
    attachments.push({
      filename: `obrazac-za-odustajanje-${args.order.id}.pdf`,
      content: buildWithdrawalFormPdf(pdfOrder).toString("base64"),
      contentType: "application/pdf",
    });
  }

  return dispatch({
    to: args.to,
    subject: `Porudžbina ${args.order.id} — potvrda`,
    html,
    text,
    bcc: cfg.orderBcc,
    attachments,
    tags: { kind: "order_confirmation", order: args.order.id },
    idempotencyKey: `order-conf:${args.order.id}`,
  });
}

export async function sendOrderStatusChanged(args: {
  order: Order;
  status: OrderStatus;
  to: string;
  trackingUrl?: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    OrderStatusChanged({
      order: args.order,
      status: args.status,
      baseUrl: cfg.baseUrl,
      trackingUrl: args.trackingUrl,
    }),
  );
  return dispatch({
    to: args.to,
    subject: `Porudžbina ${args.order.id} — ${STATUS_SUBJECT[args.status]}`,
    html,
    text,
    tags: { kind: "order_status", order: args.order.id, status: args.status },
    idempotencyKey: `order-status:${args.order.id}:${args.status}`,
  });
}

const STATUS_SUBJECT: Record<OrderStatus, string> = {
  kreirano: "primljena",
  potvrdjeno: "potvrđena",
  u_pripremi: "u pripremi",
  spremno_za_isporuku: "spremna za isporuku",
  u_isporuci: "u isporuci",
  isporuceno: "isporučena",
  otkazano: "otkazana",
  vraceno: "vraćena",
};

export async function sendFiscalReceipt(args: {
  order: Order;
  to: string;
  receiptNumber: string;
  qrUrl?: string | null;
  pdf: Buffer;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    FiscalReceiptEmail({
      order: args.order,
      receiptNumber: args.receiptNumber,
      qrUrl: args.qrUrl,
      baseUrl: cfg.baseUrl,
    }),
  );
  return dispatch({
    to: args.to,
    subject: `Fiskalni račun ${args.receiptNumber} — porudžbina ${args.order.id}`,
    html,
    text,
    bcc: cfg.orderBcc,
    attachments: [
      {
        filename: `fiskalni-racun-${args.receiptNumber}.pdf`,
        content: args.pdf.toString("base64"),
        contentType: "application/pdf",
      },
    ],
    tags: { kind: "fiscal_receipt", order: args.order.id, receipt: args.receiptNumber },
    idempotencyKey: `fiscal:${args.receiptNumber}`,
  });
}

export async function sendReclamationReceipt(args: {
  reclamation: Reclamation;
  to: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    ReclamationReceipt({ reclamation: args.reclamation, baseUrl: cfg.baseUrl }),
  );
  return dispatch({
    to: args.to,
    subject: `Reklamacija ${args.reclamation.id} — potvrda prijema`,
    html,
    text,
    bcc: cfg.orderBcc,
    tags: { kind: "reclamation_receipt", reclamation: args.reclamation.id },
    idempotencyKey: `reclamation:${args.reclamation.id}`,
  });
}

export async function sendPasswordReset(args: {
  to: string;
  token: string;
  expiresInMinutes?: number;
}): Promise<DispatchResult> {
  const cfg = getEmailConfig();
  const resetUrl = `${cfg.baseUrl}/nalog/lozinka/nova?token=${encodeURIComponent(args.token)}`;
  const { html, text } = await renderEmail(
    PasswordReset({ resetUrl, expiresInMinutes: args.expiresInMinutes }),
  );
  return dispatch({
    to: args.to,
    subject: "Resetovanje lozinke — Svet Akcija",
    html,
    text,
    tags: { kind: "password_reset" },
  });
}

export async function sendOtpEmail(args: {
  to: string;
  code: string;
  expiresInMinutes?: number;
}): Promise<DispatchResult> {
  const { html, text } = await renderEmail(
    OtpEmail({ code: args.code, expiresInMinutes: args.expiresInMinutes }),
  );
  return dispatch({
    to: args.to,
    subject: `Vaš jednokratni kod: ${args.code}`,
    html,
    text,
    tags: { kind: "otp" },
  });
}

/**
 * NextAuth Email/magic-link helper. Wired into the Auth.js Email provider
 * via `sendVerificationRequest: ({ identifier, url }) => sendMagicLink({ to: identifier, url })`.
 */
export async function sendMagicLink(args: {
  to: string;
  url: string;
}): Promise<DispatchResult> {
  const html = `<!doctype html><html><body style="font-family:Inter,sans-serif;background:#FAF7F2;padding:32px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;"><h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 12px;">Prijava na nalog</h1><p style="margin:0 0 20px;color:#3B342D;">Klikom na dugme ispod prijavićete se na svoj nalog. Link važi 15 minuta.</p><a href="${escapeAttr(args.url)}" style="display:inline-block;background:#1A1714;color:#FAF7F2;padding:12px 22px;border-radius:999px;text-decoration:none;">Prijavi me</a><p style="margin:20px 0 0;color:#6B6259;font-size:12px;">Ako niste tražili prijavu, ignorišite ovaj mejl.</p></div></body></html>`;
  return dispatch({
    to: args.to,
    subject: "Prijava na Svet Akcija",
    html,
    text: `Prijavi se: ${args.url}`,
    tags: { kind: "magic_link" },
  });
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function orderToPdfInput(order: Order) {
  return {
    number: order.id,
    createdAt: new Date(order.createdAt),
    items: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPriceSale: i.unitPriceSale,
      assemblyPrice: i.assemblyPrice ?? null,
    })),
    subtotal: order.subtotal,
    shipping: order.shipping,
    assemblyTotal: order.assemblyTotal,
    voucherCode: order.voucherCode ?? null,
    voucherDiscount: order.voucherDiscount ?? null,
    total: order.total,
    paymentMethod: order.paymentMethod,
    shipping_address: {
      firstName: order.shippingAddress.firstName,
      lastName: order.shippingAddress.lastName,
      street: order.shippingAddress.street,
      postalCode: order.shippingAddress.postalCode,
      city: order.shippingAddress.city,
    },
  };
}
