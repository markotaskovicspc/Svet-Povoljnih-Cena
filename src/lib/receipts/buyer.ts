import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { loadOrderForEmail, sendOrderConfirmation } from "@/lib/email";
import { buildInvoicePdf, type InvoiceOrderInput } from "@/lib/email/pdf";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_RECEIPT_BUCKET = "order-receipts";

export type BuyerReceiptResult =
  | {
      ok: true;
      invoiceId: string;
      number: string;
      emailed: boolean;
      pdfUrl: string | null;
      emailError?: string | null;
    }
  | { ok: false; error: string };

export async function issueBuyerReceiptForOrder(
  orderId: string,
  opts: { sendEmail?: boolean; forceEmail?: boolean } = {},
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
  const pdf = buildInvoicePdf(input);
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
      pdfUrl: uploaded?.publicUrl ?? null,
      pdfObjectKey: uploaded?.objectKey ?? null,
      recipientEmail: recipient,
      snapshot: snapshot as Prisma.InputJsonValue,
      total: row.total,
    },
    update: {
      pdfUrl: uploaded?.publicUrl ?? row.invoices[0]?.pdfUrl ?? null,
      pdfObjectKey: uploaded?.objectKey ?? row.invoices[0]?.pdfObjectKey ?? null,
      recipientEmail: recipient,
      snapshot: snapshot as Prisma.InputJsonValue,
      total: row.total,
    },
    select: {
      id: true,
      number: true,
      pdfUrl: true,
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
      pdfUrl: invoice.pdfUrl,
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
      pdfUrl: invoice.pdfUrl,
      emailError: "no_recipient",
    };
  }

  const send = await sendOrderConfirmation({
    order: loaded.order,
    to: loaded.recipient,
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
    pdfUrl: invoice.pdfUrl,
    emailError: send.ok ? null : send.error,
  };
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
  return {
    invoice,
    bytes: buildInvoicePdf(orderToPdfInput(invoice.order)),
  };
}

type OrderForReceipt = Prisma.OrderGetPayload<{
  include: {
    items: true;
    payments: true;
    user: { select: { email: true } };
  };
}>;

function orderToPdfInput(order: OrderForReceipt): InvoiceOrderInput {
  return {
    number: order.number,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPriceSale: num(i.unitPriceSale),
      assemblyPrice: i.assemblyPrice ? num(i.assemblyPrice) : null,
    })),
    subtotal: num(order.subtotal),
    shipping: num(order.shipping),
    assemblyTotal: num(order.assemblyTotal),
    voucherCode: order.voucherCode,
    voucherDiscount: order.voucherDiscount ? num(order.voucherDiscount) : null,
    total: num(order.total),
    paymentMethod: order.paymentMethod,
    shipping_address: {
      firstName: order.shipFirstName,
      lastName: order.shipLastName,
      street: order.shipStreet,
      postalCode: order.shipPostalCode,
      city: order.shipCity,
    },
  };
}

function buildReceiptSnapshot(order: OrderForReceipt, recipient: string | null) {
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
        total: num(order.total),
      },
      customer: {
        email: recipient,
        firstName: order.shipFirstName,
        lastName: order.shipLastName,
        phone: order.shipPhone,
        street: order.shipStreet,
        city: order.shipCity,
        postalCode: order.shipPostalCode,
        companyName: order.shipCompanyName,
        pib: order.shipPib,
      },
      items: order.items.map((i) => ({
        sku: i.sku,
        name: i.name,
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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
  const publicUrl = storage.getPublicUrl(objectKey).data.publicUrl;
  return { objectKey, publicUrl };
}
