import "server-only";

import { createHash } from "node:crypto";
import type { Order, OrderStatus, Reclamation, ReclamationStatus } from "@/types";
import { BRAND } from "@/lib/brand";
import { formatRsd } from "@/lib/format";
import { OrderConfirmation } from "./templates/order-confirmation";
import { IpsPaymentConfirmation } from "./templates/ips-payment-confirmation";
import { OrderStatusChanged } from "./templates/order-status-changed";
import { OrderItemsChanged } from "./templates/order-items-changed";
import { WarehouseOrderCancelled } from "./templates/warehouse-order-cancelled";
import { FiscalReceiptEmail } from "./templates/fiscal-receipt";
import { ReclamationReceipt } from "./templates/reclamation-receipt";
import { ReclamationStatusChanged } from "./templates/reclamation-status-changed";
import { GuestReclamationLink } from "./templates/guest-reclamation-link";
import { PasswordReset } from "./templates/password-reset";
import { OtpEmail } from "./templates/otp";
import { EmailConfirmation } from "./templates/email-confirmation";
import { ProductAlert } from "./templates/product-alert";
import { renderEmail } from "./render";
import { type DispatchResult, type EmailAttachment } from "./transport";
import { getEmailConfig } from "./config";
import { buildInvoicePdf, buildWithdrawalFormPdf } from "./pdf";
import {
  buildGuaranteePdf,
  GUARANTEE_TERM_TEXT,
  guaranteeItemsForOrder,
} from "./guarantee-pdf";
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
const ORDER_CONFIRMATION_BCC = "porudzbine@svetpovoljnihcena.rs";

export async function sendOrderConfirmation(args: {
  order: Order;
  to: string;
  attachInvoice?: boolean;
  idempotencyKey?: string;
  accessToken?: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const guaranteeItems = guaranteeItemsForOrder(args.order.items);
  const { html, text } = await renderEmail(
    OrderConfirmation({
      order: args.order,
      baseUrl: cfg.baseUrl,
      accessToken: args.accessToken,
      includesPurchaseDocuments: args.attachInvoice !== false,
      guaranteeTermText: guaranteeItems.length ? GUARANTEE_TERM_TEXT : undefined,
    }),
  );

  const attachments: EmailAttachment[] = [];
  if (args.attachInvoice !== false) {
    const pdfOrder = orderToPdfInput(args.order);
    attachments.push({
      filename: `predracun-racun-${args.order.id}.pdf`,
      content: (await buildInvoicePdf(pdfOrder)).toString("base64"),
      contentType: "application/pdf",
    });
    attachments.push({
      filename: `obrazac-za-odustajanje-${args.order.id}.pdf`,
      content: (await buildWithdrawalFormPdf(pdfOrder)).toString("base64"),
      contentType: "application/pdf",
    });
  }
  if (guaranteeItems.length) {
    attachments.push({
      filename: `garantni-list-${args.order.id}.pdf`,
      content: (
        await buildGuaranteePdf({
          number: args.order.id,
          createdAt: new Date(args.order.createdAt),
          items: guaranteeItems,
        })
      ).toString("base64"),
      contentType: "application/pdf",
    });
  }

  return trackedDispatch({
    kind: "order_confirmation",
    to: args.to,
    subject: `Porudžbina ${args.order.id} — potvrda`,
    html,
    text,
    // Confirmation copies belong only in the dedicated orders inbox. The
    // generic order BCC can be an alias for the same mailbox, which would make
    // the provider deliver two copies of one message.
    bcc: ORDER_CONFIRMATION_BCC,
    attachments,
    tags: { kind: "order_confirmation", order: args.order.id },
    metadata: {
      orderId: args.order.id,
      attachmentNames: attachments.map((attachment) => attachment.filename),
      attachmentCount: attachments.length,
      guaranteeItemCount: guaranteeItems.length,
    },
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

export async function sendOrderItemsChanged(args: {
  order: Order;
  to: string;
  itemName: string;
  sku: string;
  previousQty: number;
  newQty: number;
  idempotencyKey: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    OrderItemsChanged({
      order: args.order,
      itemName: args.itemName,
      sku: args.sku,
      previousQty: args.previousQty,
      newQty: args.newQty,
      baseUrl: cfg.baseUrl,
    }),
  );
  return trackedDispatch({
    kind: "order_items_changed",
    to: args.to,
    subject: `Porudžbina ${args.order.id} — izmena artikla`,
    html,
    text,
    bcc: cfg.orderBcc,
    tags: {
      kind: "order_items_changed",
      order: args.order.id,
      sku: args.sku,
    },
    idempotencyKey: args.idempotencyKey,
  });
}

export async function sendWarehouseOrderCancellation(args: {
  to: string[];
  orderNumber: string;
  pickupBatchNumbers: string[];
  removedPickupLines: number;
  activeShipmentCount: number;
  idempotencyKey: string;
}): Promise<DispatchResult> {
  if (!args.to.length) return NULL;
  const { html, text } = await renderEmail(
    WarehouseOrderCancelled({
      orderNumber: args.orderNumber,
      pickupBatchNumbers: args.pickupBatchNumbers,
      removedPickupLines: args.removedPickupLines,
      activeShipmentCount: args.activeShipmentCount,
    }),
  );
  return trackedDispatch({
    kind: "warehouse_order_cancelled",
    to: args.to,
    subject: `HITNO: otkazana porudžbina ${args.orderNumber}`,
    html,
    text,
    tags: { kind: "warehouse_order_cancelled", order: args.orderNumber },
    idempotencyKey: args.idempotencyKey,
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
  pdf?: Buffer;
  attachments?: EmailAttachment[];
  withdrawalForm?: Buffer;
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
  const attachments: EmailAttachment[] = args.attachments
    ? [...args.attachments]
    : args.pdf
      ? [
          {
            filename: `fiskalni-racun-${args.receiptNumber}.pdf`,
            content: args.pdf.toString("base64"),
            contentType: "application/pdf",
          },
        ]
      : [];
  if (args.withdrawalForm) {
    attachments.push({
      filename: `obrazac-za-odustajanje-${args.order.id}.pdf`,
      content: args.withdrawalForm.toString("base64"),
      contentType: "application/pdf",
    });
  }
  return trackedDispatch({
    kind: "fiscal_receipt",
    to: args.to,
    subject: `Fiskalni račun ${args.receiptNumber} — porudžbina ${args.order.id}`,
    html,
    text,
    bcc: cfg.orderBcc,
    attachments,
    tags: { kind: "fiscal_receipt", order: args.order.id, receipt: args.receiptNumber },
    idempotencyKey: args.idempotencyKey ?? `fiscal:${args.receiptNumber}`,
  });
}

export async function sendReclamationReceipt(args: {
  reclamation: Reclamation;
  to: string;
  guest?: boolean;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    ReclamationReceipt({
      reclamation: args.reclamation,
      baseUrl: cfg.baseUrl,
      guest: args.guest,
    }),
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
  guest?: boolean;
  idempotencyKey?: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const { html, text } = await renderEmail(
    ReclamationStatusChanged({
      reclamation: args.reclamation,
      status: args.status,
      baseUrl: cfg.baseUrl,
      guest: args.guest,
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
    idempotencyKey:
      args.idempotencyKey ??
      `reclamation-status:${args.reclamation.id}:${args.status}`,
  });
}

export async function sendGuestReclamationLink(args: {
  order: Order;
  to: string;
  accessToken: string;
}): Promise<DispatchResult> {
  if (!args.to) return NULL;
  const cfg = getEmailConfig();
  const reclamationUrl = `${cfg.baseUrl}/reklamacije/prijava?order=${encodeURIComponent(args.order.id)}&token=${encodeURIComponent(args.accessToken)}`;
  const { html, text } = await renderEmail(
    GuestReclamationLink({ order: args.order, reclamationUrl }),
  );
  return trackedDispatch({
    kind: "guest_reclamation_link",
    to: args.to,
    subject: `Link za reklamaciju — porudžbina ${args.order.id}`,
    html,
    text,
    tags: { kind: "guest_reclamation_link", order: args.order.id },
    idempotencyKey: `guest-reclamation-link:${args.order.id}:${hashId(args.accessToken)}`,
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
    firstPurchaseDiscount: order.firstPurchaseDiscount ?? null,
    savedCardDiscount: order.savedCardDiscount ?? null,
    total: order.total,
    paymentMethod: order.paymentMethod,
    shipping_address: {
      firstName: order.shippingAddress.firstName,
      lastName: order.shippingAddress.lastName,
      street: order.shippingAddress.street,
      postalCode: order.shippingAddress.postalCode,
      city: order.shippingAddress.city,
      companyName: order.shippingAddress.companyName,
      pib: order.shippingAddress.pib,
    },
    billing_address: order.billingAddress
      ? {
          firstName: order.billingAddress.firstName,
          lastName: order.billingAddress.lastName,
          street: order.billingAddress.street,
          postalCode: order.billingAddress.postalCode,
          city: order.billingAddress.city,
          companyName: order.billingAddress.companyName,
          pib: order.billingAddress.pib,
        }
      : undefined,
  };
}
