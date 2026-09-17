import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { loadOrderForEmail, sendOrderConfirmation } from "@/lib/email";
import { buildInvoicePdf, type InvoiceOrderInput } from "@/lib/email/pdf";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { createAdminClient } from "@/lib/supabase/admin";
import { envValue } from "@/lib/env";
import { formatProductDisplayName } from "@/lib/product-name";
import { resolveOrderDocumentBuyerAddress } from "@/lib/document-buyer";

const DEFAULT_RECEIPT_BUCKET = "order-receipts";

export type BuyerReceiptResult =
  | {
      ok: true;
      invoiceId: string;
      number: string;
      emailed: boolean;
      emailError?: string | null;
    }
  | { ok: false; error: string };

export type FiscalBuyerInvoiceResult =
  | {
      ok: true;
      issued: true;
      invoiceId: string;
      number: string;
      bytes: Buffer;
    }
  | { ok: true; issued: false }
  | { ok: false; error: string };

export async function issueBuyerReceiptForOrder(
  orderId: string,
  opts: {
    sendEmail?: boolean;
    forceEmail?: boolean;
    accessToken?: string;
    /** Clear an older stored PDF when this regeneration cannot replace it. */
    invalidateExistingPdfOnUploadFailure?: boolean;
  } = {},
): Promise<BuyerReceiptResult> {
  const row = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      user: { select: { email: true } },
      invoices: { where: { kind: "PROFORMA" }, take: 1 },
    },
  });
  if (!row) return { ok: false, error: `Order ${orderId} ne postoji.` };

  const recipient = row.user?.email ?? row.guestEmail ?? null;
  const number = `PR-${row.number}`;
  const input = orderToPdfInput(row);
  const pdf = await buildInvoicePdf(input);
  const uploaded = await uploadReceiptPdf({
    orderNumber: row.number,
    receiptNumber: number,
    bytes: pdf,
  }).catch((err) => {
    console.error("[receipt] upload failed", err);
    return null;
  });

  const snapshot = buildReceiptSnapshot(row, recipient);
  const invoice = await db.invoice.upsert({
    where: { orderId_kind: { orderId: row.id, kind: "PROFORMA" } },
    create: {
      orderId: row.id,
      kind: "PROFORMA",
      status: "ISSUED",
      number,
      // Bucket is private: only the object key is stored; bytes are
      // fetched server-side when attaching to email.
      pdfObjectKey: uploaded?.objectKey ?? null,
      recipientEmail: recipient,
      snapshot: snapshot as Prisma.InputJsonValue,
      total: row.total,
    },
    update: {
      pdfUrl: null,
      pdfObjectKey:
        uploaded?.objectKey ??
        (opts.invalidateExistingPdfOnUploadFailure
          ? null
          : row.invoices[0]?.pdfObjectKey ?? null),
      recipientEmail: recipient,
      snapshot: snapshot as Prisma.InputJsonValue,
      total: row.total,
    },
    select: {
      id: true,
      number: true,
      emailedAt: true,
      status: true,
    },
  });

  const shouldSend =
    opts.sendEmail !== false && recipient && (opts.forceEmail || !invoice.emailedAt);
  if (!shouldSend) {
    return {
      ok: true,
      invoiceId: invoice.id,
      number: invoice.number,
      emailed: false,
    };
  }

  const loaded = await loadOrderForEmail(row.id);
  if (!loaded?.recipient) {
    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: "EMAIL_FAILED", emailError: "no_recipient" },
    });
    return {
      ok: true,
      invoiceId: invoice.id,
      number: invoice.number,
      emailed: false,
      emailError: "no_recipient",
    };
  }

  const send = await sendOrderConfirmation({
    order: loaded.order,
    to: loaded.recipient,
    accessToken: opts.accessToken,
    idempotencyKey: opts.forceEmail
      ? `order-conf:${loaded.order.id}:resend:${Date.now()}`
      : undefined,
  });
  await db.invoice.update({
    where: { id: invoice.id },
    data: send.ok
      ? { status: "EMAIL_SENT", emailedAt: new Date(), emailError: null }
      : { status: "EMAIL_FAILED", emailError: send.error },
  });

  return {
    ok: true,
    invoiceId: invoice.id,
    number: invoice.number,
    emailed: send.ok,
    emailError: send.ok ? null : send.error,
  };
}

/**
 * Creates the accounting copy which accompanies an already-issued fiscal
 * receipt. The checkout pro-forma remains a separate PROFORMA invoice.
 */
export async function issueFiscalBuyerInvoiceForOrder(
  orderId: string,
  args: {
    issuedAt: Date;
    fiscalReceiptNumbers: string[];
  },
): Promise<FiscalBuyerInvoiceResult> {
  const row = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      user: { select: { email: true } },
      invoices: { where: { kind: "BUYER_RECEIPT" }, take: 1 },
    },
  });
  if (!row) return { ok: false, error: `Order ${orderId} ne postoji.` };

  const buyer = resolveOrderDocumentBuyerAddress(row);
  if (!buyer.companyName?.trim() && !buyer.pib?.trim()) {
    return { ok: true, issued: false };
  }

  const fiscalReceiptNumbers = args.fiscalReceiptNumbers
    .map((number) => number.trim())
    .filter(Boolean);
  if (!fiscalReceiptNumbers.length) {
    return { ok: false, error: "Nedostaje broj fiskalnog računa." };
  }

  const recipient = row.user?.email ?? row.guestEmail ?? null;
  const number = `R-${row.number}`;
  const bytes = await buildInvoicePdf(orderToPdfInput(row), {
    kind: "BUYER_RECEIPT",
    number,
    issuedAt: args.issuedAt,
    fiscalReceiptNumbers,
  });
  const uploaded = await uploadReceiptPdf({
    orderNumber: row.number,
    receiptNumber: number,
    bytes,
  }).catch((err) => {
    console.error("[buyer-invoice] upload failed", err);
    return null;
  });

  const snapshot = {
    ...buildReceiptSnapshot(row, recipient),
    fiscal: {
      issuedAt: args.issuedAt.toISOString(),
      receiptNumbers: fiscalReceiptNumbers,
    },
  };
  const invoice = await db.invoice.upsert({
    where: { orderId_kind: { orderId: row.id, kind: "BUYER_RECEIPT" } },
    create: {
      orderId: row.id,
      kind: "BUYER_RECEIPT",
      status: "ISSUED",
      number,
      pdfObjectKey: uploaded?.objectKey ?? null,
      recipientEmail: recipient,
      snapshot: snapshot as Prisma.InputJsonValue,
      total: row.total,
      issuedAt: args.issuedAt,
    },
    update: {
      status: "ISSUED",
      number,
      pdfUrl: null,
      pdfObjectKey: uploaded?.objectKey ?? row.invoices[0]?.pdfObjectKey ?? null,
      recipientEmail: recipient,
      emailedAt: null,
      emailError: null,
      snapshot: snapshot as Prisma.InputJsonValue,
      total: row.total,
      issuedAt: args.issuedAt,
    },
    select: { id: true, number: true },
  });

  return {
    ok: true,
    issued: true,
    invoiceId: invoice.id,
    number: invoice.number,
    bytes,
  };
}

export async function markFiscalBuyerInvoiceEmailStatus(
  invoiceId: string,
  result: { emailedAt: Date | null; error: string | null },
) {
  await db.invoice.update({
    where: { id: invoiceId },
    data: result.emailedAt
      ? { status: "EMAIL_SENT", emailedAt: result.emailedAt, emailError: null }
      : { status: "EMAIL_FAILED", emailedAt: null, emailError: result.error },
  });
}

export async function buildBuyerReceiptPdfForInvoice(invoiceId: string) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      order: {
        include: {
          items: { orderBy: { id: "asc" } },
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          user: { select: { email: true } },
        },
      },
    },
  });
  if (!invoice) return null;
  const snapshot = invoice.snapshot as {
    fiscal?: { issuedAt?: string; receiptNumbers?: string[] };
  } | null;
  const fiscalIssuedAt = snapshot?.fiscal?.issuedAt
    ? new Date(snapshot.fiscal.issuedAt)
    : invoice.issuedAt;
  return {
    invoice,
    bytes: await buildInvoicePdf(
      orderToPdfInput(invoice.order),
      invoice.kind === "BUYER_RECEIPT"
        ? {
            kind: "BUYER_RECEIPT",
            number: invoice.number,
            issuedAt: fiscalIssuedAt,
            fiscalReceiptNumbers: snapshot?.fiscal?.receiptNumbers ?? [],
          }
        : { kind: "PROFORMA" },
    ),
  };
}

type OrderForReceipt = Prisma.OrderGetPayload<{
  include: {
    items: true;
    payments: true;
    user: { select: { email: true } };
  };
}>;

export function orderToPdfInput(order: OrderForReceipt): InvoiceOrderInput {
  const email = order.user?.email ?? order.guestEmail ?? null;
  return {
    number: order.number,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({
      sku: i.sku,
      name: formatProductDisplayName(i.name, i.attribute1),
      qty: i.qty,
      unitPriceSale: num(i.unitPriceSale),
      assemblyPrice: i.assemblyPrice ? num(i.assemblyPrice) : null,
    })),
    subtotal: num(order.subtotal),
    shipping: num(order.shipping),
    assemblyTotal: num(order.assemblyTotal),
    voucherCode: order.voucherCode,
    voucherDiscount: order.voucherDiscount ? num(order.voucherDiscount) : null,
    firstPurchaseDiscount: order.firstPurchaseDiscount
      ? num(order.firstPurchaseDiscount)
      : null,
    savedCardDiscount: order.savedCardDiscount
      ? num(order.savedCardDiscount)
      : null,
    total: num(order.total),
    paymentMethod: order.paymentMethod,
    shipping_address: {
      firstName: order.shipFirstName,
      lastName: order.shipLastName,
      street: order.shipStreet,
      postalCode: order.shipPostalCode,
      city: order.shipCity,
      phone: order.shipPhone,
      email,
      companyName: order.shipCompanyName,
      pib: order.shipPib,
    },
    billing_address:
      !order.billingSameAsShipping && order.billFirstName
        ? {
            firstName: order.billFirstName,
            lastName: order.billLastName ?? "",
            street: order.billStreet ?? "",
            postalCode: order.billPostalCode ?? "",
            city: order.billCity ?? "",
            phone: order.shipPhone,
            email,
            companyName: order.billCompanyName,
            pib: order.billPib,
          }
        : undefined,
  };
}

export function buildReceiptSnapshot(order: OrderForReceipt, recipient: string | null) {
  const buyer = resolveOrderDocumentBuyerAddress(order);
  return {
    merchant: MERCHANT_LEGAL_INFO,
    recipient,
    order: {
      id: order.id,
      number: order.number,
      createdAt: order.createdAt.toISOString(),
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.payments[0]?.status ?? null,
      totals: {
        subtotal: num(order.subtotal),
        shipping: num(order.shipping),
        assemblyTotal: num(order.assemblyTotal),
        savings: num(order.savings),
        voucherDiscount: order.voucherDiscount ? num(order.voucherDiscount) : null,
        firstPurchaseDiscount: order.firstPurchaseDiscount
          ? num(order.firstPurchaseDiscount)
          : null,
        savedCardDiscount: order.savedCardDiscount
          ? num(order.savedCardDiscount)
          : null,
        total: num(order.total),
      },
      customer: {
        email: recipient,
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        phone: order.shipPhone,
        street: buyer.street,
        city: buyer.city,
        postalCode: buyer.postalCode,
        companyName: buyer.companyName,
        pib: buyer.pib,
        addressSource: buyer.source,
      },
      items: order.items.map((i) => ({
        sku: i.sku,
        name: formatProductDisplayName(i.name, i.attribute1),
        qty: i.qty,
        unitPriceFull: num(i.unitPriceFull),
        unitPriceSale: num(i.unitPriceSale),
        withAssembly: i.withAssembly,
        assemblyPrice: i.assemblyPrice ? num(i.assemblyPrice) : null,
      })),
    },
  };
}

async function uploadReceiptPdf(args: {
  orderNumber: string;
  receiptNumber: string;
  bytes: Buffer;
}) {
  if (!envValue("NEXT_PUBLIC_SUPABASE_URL") || !envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    return null;
  }
  const bucket = process.env.SUPABASE_RECEIPT_BUCKET ?? DEFAULT_RECEIPT_BUCKET;
  const objectKey = `${args.orderNumber}/${args.receiptNumber}.pdf`;
  const client = createAdminClient();
  const storage = client.storage.from(bucket);
  const { error } = await storage.upload(objectKey, args.bytes, {
    upsert: true,
    contentType: "application/pdf",
    cacheControl: "3600",
  });
  if (error) throw error;
  return { objectKey };
}
