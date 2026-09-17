import "server-only";

import { type FiscalDocumentSource, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { loadOrderForEmail, sendFiscalReceipt } from "@/lib/email";
import { buildWithdrawalFormPdf } from "@/lib/email/pdf";
import { num } from "@/lib/api/_helpers";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { resolveDocumentBuyerAddress } from "@/lib/document-buyer";
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
import {
  issueFiscalBuyerInvoiceForOrder,
  markFiscalBuyerInvoiceEmailStatus,
  type FiscalBuyerInvoiceResult,
} from "@/lib/receipts";

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
  const buyerAddress = resolveDocumentBuyerAddress(
    loaded.order.shippingAddress,
    loaded.order.billingAddress,
  );
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
      buyer: {
        name:
          buyerAddress.companyName ??
          `${buyerAddress.firstName} ${buyerAddress.lastName}`,
        tin: buyerAddress.pib,
        address: `${buyerAddress.street}, ${buyerAddress.postalCode} ${buyerAddress.city}`,
      },
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

  const fiscalReceiptNumbers = receiptDocuments.map(
    (document) => document.receiptNumber!,
  );
  const finalFiscalizedAt = receiptDocuments.at(-1)!.issuedAt!;
  let buyerInvoice: FiscalBuyerInvoiceResult;
  try {
    buyerInvoice = await issueFiscalBuyerInvoiceForOrder(orderId, {
      issuedAt: finalFiscalizedAt,
      fiscalReceiptNumbers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    buyerInvoice = { ok: false, error: message };
  }
  if (!buyerInvoice.ok) {
    console.error(
      `[fiscal] buyer invoice failed for ${orderId}: ${buyerInvoice.error}`,
    );
  } else if (buyerInvoice.issued) {
    attachments.push({
      filename: `racun-${loaded.order.id}.pdf`,
      content: buyerInvoice.bytes.toString("base64"),
      contentType: "application/pdf",
    });
  }

  const withdrawalForm = await buildWithdrawalFormPdf({
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
      companyName: loaded.order.shippingAddress.companyName,
      pib: loaded.order.shippingAddress.pib,
    },
    billing_address: loaded.order.billingAddress
      ? {
          firstName: loaded.order.billingAddress.firstName,
          lastName: loaded.order.billingAddress.lastName,
          street: loaded.order.billingAddress.street,
          postalCode: loaded.order.billingAddress.postalCode,
          city: loaded.order.billingAddress.city,
          companyName: loaded.order.billingAddress.companyName,
          pib: loaded.order.billingAddress.pib,
        }
      : undefined,
  });

  const receiptNumbers = fiscalReceiptNumbers.join(", ");
  const send = await sendFiscalReceipt({
    order: loaded.order,
    to: loaded.recipient,
    receiptNumber: receiptNumbers,
    qrUrl: receiptDocuments[0]?.qrUrl,
    attachments,
    withdrawalForm,
    buyerInvoiceAttached: buyerInvoice.ok && buyerInvoice.issued,
    idempotencyKey: opts.forceEmail
      ? `fiscal:${orderId}:final:resend:${Date.now()}`
      : `fiscal:${orderId}:final`,
  });

  if (!send.ok) {
    await markEmailStatus(receiptDocuments.map((document) => document.id), null, send.error);
    if (buyerInvoice.ok && buyerInvoice.issued) {
      await markFiscalBuyerInvoiceEmailStatus(buyerInvoice.invoiceId, {
        emailedAt: null,
        error: send.error,
      }).catch((err) => {
        console.error(`[fiscal] buyer invoice email status failed for ${orderId}`, err);
      });
    }
    return { outcome, emailed: false, emailError: send.error };
  }

  const emailedAt = new Date();
  await markEmailStatus(receiptDocuments.map((document) => document.id), emailedAt, null);
  if (buyerInvoice.ok && buyerInvoice.issued) {
    await markFiscalBuyerInvoiceEmailStatus(buyerInvoice.invoiceId, {
      emailedAt,
      error: null,
    }).catch((err) => {
      console.error(`[fiscal] buyer invoice email status failed for ${orderId}`, err);
    });
  }
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
