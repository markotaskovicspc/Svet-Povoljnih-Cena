import "server-only";

import { loadOrderForEmail, sendFiscalReceipt } from "@/lib/email";
import { buildFiscalReceiptPdf } from "./pdf";
import {
  paymentMethodLabel,
  tryIssueFiscalReceipt,
  type FiscalIssueOutcome,
} from "./issue";
import { getFiscalConfig } from "./config";

/**
 * Phase 4F — End-to-end pipeline triggered from the warehouse pickup
 * event (courier `PICKED_UP` webhook or admin "mark picked up" action):
 *
 *   1. Idempotently call the SUF gateway to mint the fiscal receipt.
 *   2. Render the PDF slip.
 *   3. Email the customer with the slip attached.
 *
 * Failures of step 2/3 do NOT roll back step 1 — once the gateway has
 * fiscalized the sale we own the obligation regardless of whether the
 * email landed. We log and surface the error to the caller so the admin
 * dashboard can show a "resend" button later.
 */

export interface DeliverResult {
  outcome: FiscalIssueOutcome;
  emailed: boolean;
  emailError?: string;
}

export async function issueAndDeliverFiscalReceipt(
  orderId: string,
  opts: { forceEmail?: boolean } = {},
): Promise<DeliverResult> {
  const outcome = await tryIssueFiscalReceipt(orderId);
  if (!outcome.ok) {
    return { outcome, emailed: false };
  }

  // Reload via the email adapter so the template gets the canonical
  // `Order` shape with lower-cased enums + decimal coercion.
  const loaded = await loadOrderForEmail(orderId);
  if (!loaded?.recipient) {
    return { outcome, emailed: false, emailError: "no_recipient" };
  }

  const cfg = getFiscalConfig();
  const pdf = buildFiscalReceiptPdf({
    orderNumber: loaded.order.id,
    receiptNumber: outcome.receipt.receiptNumber,
    fiscalizedAt: outcome.receipt.fiscalizedAt,
    merchant: {
      name: "Svet Akcija d.o.o.",
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
    items: loaded.order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPrice:
        i.unitPriceSale + (i.withAssembly && i.assemblyPrice ? i.assemblyPrice : 0),
    })),
    total: loaded.order.total,
    paymentMethodLabel: paymentMethodLabel(
      // Reverse the lower-cased enum back to the Prisma value the helper expects.
      mapBackPaymentMethod(loaded.order.paymentMethod),
    ),
    qrUrl: outcome.receipt.qrUrl,
  });

  const send = await sendFiscalReceipt({
    order: loaded.order,
    to: loaded.recipient,
    receiptNumber: outcome.receipt.receiptNumber,
    qrUrl: outcome.receipt.qrUrl,
    pdf,
    idempotencyKey: opts.forceEmail
      ? `fiscal:${outcome.receipt.receiptNumber}:resend:${Date.now()}`
      : undefined,
  });

  if (!send.ok) {
    return { outcome, emailed: false, emailError: send.error };
  }
  return { outcome, emailed: true };
}

function mapBackPaymentMethod(
  m: string,
):
  | "POUZECE_GOTOVINA"
  | "POUZECE_KARTICA"
  | "KARTICA"
  | "GOOGLE_PAY"
  | "APPLE_PAY"
  | "IPS"
  | "UPLATA_NA_RACUN" {
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
