import "server-only";

import { type FiscalDocumentSource, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { loadOrderForEmail, sendFiscalReceipt } from "@/lib/email";
import { buildWithdrawalFormPdf } from "@/lib/email/pdf";
import { num } from "@/lib/api/_helpers";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { buildFiscalReceiptPdf } from "./pdf";
import { downloadFiscalPdf } from "./pdf-storage";
import {
  getIssuedSaleDocumentsForOrder,
  isOrderFullyFiscalized,
  issueFiscalSale,
  paymentMethodLabel,
  type FiscalIssueOutcome,
} from "./issue";
import { getFiscalConfig } from "./config";

export interface DeliverResult {
  outcome: FiscalIssueOutcome;
  emailed: boolean;
  emailError?: string;
}

export async function issueAndDeliverFiscalReceipt(
  orderId: string,
  opts: {
    forceEmail?: boolean;
    source?: Exclude<FiscalDocumentSource, "REFUND">;
    paymentMethod?: PaymentMethod;
    orderItemIds?: string[];
  } = {},
): Promise<DeliverResult> {
  let outcome: FiscalIssueOutcome;
  try {
    outcome = await issueFiscalSale({
      orderId,
      orderItemIds: opts.orderItemIds,
      source: opts.source ?? "AUTO_PICKUP",
      paymentMethod: opts.paymentMethod,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fiscal] issue threw for ${orderId}: ${message}`);
    outcome = { ok: false, reason: "gateway_failure", error: message };
  }
  if (!outcome.ok) return { outcome, emailed: false };

  if (!opts.forceEmail && !outcome.created) {
    return { outcome, emailed: false };
  }

  const fullyFiscalized = await isOrderFullyFiscalized(orderId);
  if (!fullyFiscalized && !opts.forceEmail) {
    return { outcome, emailed: false };
  }

  const loaded = await loadOrderForEmail(orderId);
  if (!loaded?.recipient) {
    return { outcome, emailed: false, emailError: "no_recipient" };
  }

  const documents = await getIssuedSaleDocumentsForOrder(orderId);
  const receiptDocuments = documents.filter((document) => document.receiptNumber && document.issuedAt);
  if (!receiptDocuments.length) {
    return { outcome, emailed: false, emailError: "no_fiscal_documents" };
  }

  const cfg = getFiscalConfig();
  const attachments = await Promise.all(receiptDocuments.map(async (document) => {
    // Prefer the provider-issued official PDF (QR + Tax Authority
    // signature); the locally rendered slip is the fallback.
    if (document.pdfObjectKey) {
      try {
        const official = await downloadFiscalPdf(document.pdfObjectKey);
        if (official) {
          return {
            filename: `fiskalni-racun-${document.receiptNumber}.pdf`,
            content: official.toString("base64"),
            contentType: "application/pdf",
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[fiscal] official PDF download failed for ${document.id}: ${message}`);
      }
    }
    const pdf = buildFiscalReceiptPdf({
      orderNumber: loaded.order.id,
      receiptNumber: document.receiptNumber!,
      fiscalizedAt: document.issuedAt!,
      merchant: {
        name: MERCHANT_LEGAL_INFO.name,
        tin: cfg.tin,
        locationId: cfg.locationId,
      },
      buyer: loaded.order.billingAddress
        ? {
            name:
              loaded.order.billingAddress.companyName ??
              `${loaded.order.billingAddress.firstName} ${loaded.order.billingAddress.lastName}`,
            tin: loaded.order.billingAddress.pib,
            address: `${loaded.order.billingAddress.street}, ${loaded.order.billingAddress.postalCode} ${loaded.order.billingAddress.city}`,
          }
        : undefined,
      items: document.lines.map((line) => ({
        sku: line.sku,
        name: line.shortName,
        qty: line.qty,
        unitPrice: num(line.unitPriceGross),
      })),
      total: document.lines.reduce((sum, line) => sum + num(line.totalGross), 0),
      paymentMethodLabel: paymentMethodLabel(
        document.paymentMethod ?? mapBackPaymentMethod(loaded.order.paymentMethod),
      ),
      qrUrl: document.qrUrl,
    });
    return {
      filename: `fiskalni-racun-${document.receiptNumber}.pdf`,
      content: pdf.toString("base64"),
      contentType: "application/pdf",
    };
  }));

  const withdrawalForm = buildWithdrawalFormPdf({
    number: loaded.order.id,
    createdAt: new Date(loaded.order.createdAt),
    items: loaded.order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      unitPriceSale: item.unitPriceSale,
      assemblyPrice: item.assemblyPrice ?? null,
    })),
    subtotal: loaded.order.subtotal,
    shipping: loaded.order.shipping,
    assemblyTotal: loaded.order.assemblyTotal,
    voucherCode: loaded.order.voucherCode ?? null,
    voucherDiscount: loaded.order.voucherDiscount ?? null,
    total: loaded.order.total,
    paymentMethod: loaded.order.paymentMethod,
    shipping_address: {
      firstName: loaded.order.shippingAddress.firstName,
      lastName: loaded.order.shippingAddress.lastName,
      street: loaded.order.shippingAddress.street,
      postalCode: loaded.order.shippingAddress.postalCode,
      city: loaded.order.shippingAddress.city,
    },
  });

  const receiptNumbers = receiptDocuments.map((document) => document.receiptNumber).join(", ");
  const send = await sendFiscalReceipt({
    order: loaded.order,
    to: loaded.recipient,
    receiptNumber: receiptNumbers,
    qrUrl: receiptDocuments[0]?.qrUrl,
    attachments,
    withdrawalForm,
    idempotencyKey: opts.forceEmail
      ? `fiscal:${orderId}:final:resend:${Date.now()}`
      : `fiscal:${orderId}:final`,
  });

  if (!send.ok) {
    await markEmailStatus(receiptDocuments.map((document) => document.id), null, send.error);
    return { outcome, emailed: false, emailError: send.error };
  }

  await markEmailStatus(receiptDocuments.map((document) => document.id), new Date(), null);
  return { outcome, emailed: true };
}

async function markEmailStatus(documentIds: string[], emailedAt: Date | null, emailError: string | null) {
  if (!documentIds.length) return;
  await db.fiscalDocument.updateMany({
    where: { id: { in: documentIds } },
    data: { emailedAt, emailError },
  });
}

function mapBackPaymentMethod(m: string): PaymentMethod {
  switch (m) {
    case "pouzece_gotovina":
      return "POUZECE_GOTOVINA";
    case "pouzece_kartica":
      return "POUZECE_KARTICA";
    case "kartica":
      return "KARTICA";
    case "google_pay":
      return "GOOGLE_PAY";
    case "apple_pay":
      return "APPLE_PAY";
    case "ips":
      return "IPS";
    default:
      return "UPLATA_NA_RACUN";
  }
}
