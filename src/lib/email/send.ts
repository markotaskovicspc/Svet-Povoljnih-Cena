import "server-only";

import { createHash } from "node:crypto";
import type { Order, OrderStatus, Reclamation, ReclamationStatus } from "@/types";
import { BRAND } from "@/lib/brand";
import { formatRsd } from "@/lib/format";
import { OrderConfirmation } from "./templates/order-confirmation";
import { IpsPaymentConfirmation } from "./templates/ips-payment-confirmation";
import { OrderStatusChanged } from "./templates/order-status-changed";
import { FiscalReceiptEmail } from "./templates/fiscal-receipt";
import { ReclamationReceipt } from "./templates/reclamation-receipt";
import { ReclamationStatusChanged } from "./templates/reclamation-status-changed";
import { PasswordReset } from "./templates/password-reset";
import { OtpEmail } from "./templates/otp";
import { EmailConfirmation } from "./templates/email-confirmation";
import { ProductAlert } from "./templates/product-alert";
import { renderEmail } from "./render";
import { type DispatchResult, type EmailAttachment } from "./transport";
import { getEmailConfig } from "./config";
import { buildInvoicePdf, buildWithdrawalFormPdf } from "./pdf";
import { trackedDispatch } from "./tracking";
import { buildEmailUnsubscribeUrl } from "./unsubscribe";

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
  idempotencyKey?: string;
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
      filename: `predracun-racun-${args.order.id}.pdf`,
      content: buildInvoicePdf(pdfOrder).toString("base64"),
      contentType: "application/pdf",
    });
    attachments.push({
      filename: `obrazac-za-odustajanje-${args.order.id}.pdf`,
      content: buildWithdrawalFormPdf(pdfOrder).toString("base64"),
      contentType: "application/pdf",
    });
  }

  return trackedDispatch({
    kind: "order_confirmation",
    to: args.to,
    subject: `Porudžbina ${args.order.id} — potvrda`,
    html,
    text,
    bcc: cfg.orderBcc,
    attachments,
    tags: { kind: "order_confirmation", order: args.order.id },
    idempotencyKey: args.idempotencyKey ?? `order-conf:${args.order.id}`,
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
  return trackedDispatch({
    kind: "order_status",
    to: args.to,
    subject: `Porudžbina ${args.order.id} — ${STATUS_SUBJECT[args.status]}`,
    html,
    text,
    tags: { kind: "order_status", order: args.order.id, status: args.status },
    idempotencyKey: `order-status:${args.order.id}:${args.status}`,
  });
}

export async function sendIpsPaymentConfirmation(args: {
  order: Order;
  to: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    IpsPaymentConfirmation({ order: args.order, baseUrl: cfg.baseUrl }),
  );
  return trackedDispatch({
    kind: "ips_payment_confirmation",
    to: args.to,
    subject: `IPS plaćanje ${args.order.id} — potvrda`,
    html,
    text,
    bcc: cfg.orderBcc,
    tags: {
      kind: "ips_payment_confirmation",
      order: args.order.id,
      paymentReference: args.order.payment?.paymentReference ?? "none",
    },
    metadata: {
      paymentReference: args.order.payment?.paymentReference ?? null,
      paidAt: args.order.payment?.paidAt ?? null,
    },
    idempotencyKey: `ips-payment:${args.order.id}`,
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
  idempotencyKey?: string;
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
  return trackedDispatch({
    kind: "fiscal_receipt",
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
    idempotencyKey: args.idempotencyKey ?? `fiscal:${args.receiptNumber}`,
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
  return trackedDispatch({
    kind: "reclamation_receipt",
    to: args.to,
    subject: `Reklamacija ${args.reclamation.id} — potvrda prijema`,
    html,
    text,
    bcc: cfg.orderBcc,
    tags: { kind: "reclamation_receipt", reclamation: args.reclamation.id },
    idempotencyKey: `reclamation:${args.reclamation.id}`,
  });
}

export async function sendReclamationStatusChanged(args: {
  reclamation: Reclamation;
  status: ReclamationStatus;
  to: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    ReclamationStatusChanged({
      reclamation: args.reclamation,
      status: args.status,
      baseUrl: cfg.baseUrl,
    }),
  );
  return trackedDispatch({
    kind: "reclamation_status",
    to: args.to,
    subject: `Reklamacija ${args.reclamation.id} — promena statusa`,
    html,
    text,
    bcc: cfg.orderBcc,
    tags: {
      kind: "reclamation_status",
      reclamation: args.reclamation.id,
      status: args.status,
    },
    idempotencyKey: `reclamation-status:${args.reclamation.id}:${args.status}`,
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
  return trackedDispatch({
    kind: "password_reset",
    to: args.to,
    subject: `Resetovanje lozinke — ${BRAND.name}`,
    html,
    text,
    tags: { kind: "password_reset" },
    idempotencyKey: `password-reset:${hashId(args.token)}`,
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
  return trackedDispatch({
    kind: "otp",
    to: args.to,
    subject: `Vaš jednokratni kod: ${args.code}`,
    html,
    text,
    tags: { kind: "otp" },
  });
}

export async function sendEmailConfirmation(args: {
  to: string;
  token: string;
  expiresInHours?: number;
  includeFirstPurchaseOffer?: boolean;
  marketingUnsubscribeUrl?: string;
}): Promise<DispatchResult> {
  const cfg = getEmailConfig();
  const confirmUrl = `${cfg.baseUrl}/nalog/email/potvrdi?token=${encodeURIComponent(args.token)}`;
  const { html, text } = await renderEmail(
    EmailConfirmation({
      confirmUrl,
      expiresInHours: args.expiresInHours,
      includeFirstPurchaseOffer: args.includeFirstPurchaseOffer,
      marketingUnsubscribeUrl: args.marketingUnsubscribeUrl,
    }),
  );
  return trackedDispatch({
    kind: "email_confirmation",
    to: args.to,
    subject: `Potvrdite e-poštu — ${BRAND.name}`,
    html,
    text,
    tags: { kind: "email_confirmation" },
    idempotencyKey: `email-confirm:${hashId(args.token)}`,
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
  return trackedDispatch({
    kind: "magic_link",
    to: args.to,
    subject: `Prijava na ${BRAND.name}`,
    html,
    text: `Prijavi se: ${args.url}`,
    tags: { kind: "magic_link" },
  });
}

export async function sendBackInStockAlert(args: {
  to: string;
  userId: string;
  product: AlertProduct;
}): Promise<DispatchResult> {
  return sendProductAlert({
    kind: "back_in_stock",
    to: args.to,
    userId: args.userId,
    product: args.product,
  });
}

export async function sendOnSaleAlert(args: {
  to: string;
  userId: string;
  product: AlertProduct;
}): Promise<DispatchResult> {
  return sendProductAlert({
    kind: "on_sale",
    to: args.to,
    userId: args.userId,
    product: args.product,
  });
}

interface AlertProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  fullPrice: number;
  salePrice?: number | null;
}

async function sendProductAlert(args: {
  kind: "back_in_stock" | "on_sale";
  to: string;
  userId: string;
  product: AlertProduct;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const productUrl = `${cfg.baseUrl}/p/${encodeURIComponent(args.product.slug)}`;
  const manageUrl = buildEmailUnsubscribeUrl({
    purpose: "alert",
    userId: args.userId,
    productId: args.product.id,
    alert: args.kind,
  });
  const price = args.product.salePrice ?? args.product.fullPrice;
  const { html, text } = await renderEmail(
    ProductAlert({
      kind: args.kind,
      product: {
        name: args.product.name,
        sku: args.product.sku,
        price: formatRsd(price),
      },
      productUrl,
      manageUrl,
    }),
  );
  return trackedDispatch({
    kind: args.kind,
    to: args.to,
    subject:
      args.kind === "back_in_stock"
        ? `${args.product.name} je ponovo na stanju`
        : `${args.product.name} je na akciji`,
    html,
    text,
    tags: {
      kind: args.kind,
      product: args.product.sku,
    },
    idempotencyKey: `${args.kind}:${args.userId}:${args.product.id}`,
  });
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function hashId(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
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
