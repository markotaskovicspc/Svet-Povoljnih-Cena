import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { loadOrderForEmail } from "@/lib/email";
import { getEmailConfig } from "@/lib/email/config";
import { buildWithdrawalFormPdf } from "@/lib/email/pdf";
import { buildGuaranteePdf, guaranteeItemsForOrder } from "@/lib/email/guarantee-pdf";
import { resolveDocumentBuyerAddress } from "@/lib/document-buyer";

/**
 * Customer documents for buyers without e-mail (linked from Viber):
 * withdrawal form, guarantee and fiscal receipts.
 *
 * Links carry a stateless HMAC of the order number, so they keep working when
 * the guest order access token is rotated and need no stored raw token.
 */

export type CustomerDocumentKind = "odustanak" | "garancija" | "fiskalni";

function secret() {
  const configured =
    process.env.ORDER_ACCESS_TOKEN_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("ORDER_ACCESS_TOKEN_SECRET ili AUTH_SECRET mora biti podešen u produkciji.");
  }
  return configured || "spc-local-order-documents-secret";
}

export function signOrderDocumentsToken(orderNumber: string) {
  return createHmac("sha256", secret()).update("order-documents:").update(orderNumber, "utf8").digest("base64url").slice(0, 32);
}

export function verifyOrderDocumentsToken(orderNumber: string | null | undefined, token: string | null | undefined) {
  if (!orderNumber || !token) return false;
  const expected = Buffer.from(signOrderDocumentsToken(orderNumber));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function orderDocumentsUrl(orderNumber: string) {
  const base = getEmailConfig().baseUrl.replace(/\/$/, "");
  return `${base}/porudzbina/dokumenti?order=${encodeURIComponent(orderNumber)}&t=${signOrderDocumentsToken(orderNumber)}`;
}

/**
 * Short form for Viber template parameters: no scheme, query string or "&"
 * (Viber rejects those in template variables). /d/<order>/<token> redirects
 * to the documents page.
 */
export function orderDocumentsShortLink(orderNumber: string) {
  const host = new URL(getEmailConfig().baseUrl).host;
  return `${host}/d/${encodeURIComponent(orderNumber)}/${signOrderDocumentsToken(orderNumber)}`;
}

export interface CustomerDocumentLink {
  kind: CustomerDocumentKind;
  index?: number;
  label: string;
}

/** Documents currently available for the order (fiscal receipts only after fiscalization). */
export async function listCustomerDocuments(orderNumber: string): Promise<{ orderNumber: string; documents: CustomerDocumentLink[] } | null> {
  const order = await db.order.findUnique({ where: { number: orderNumber }, select: { id: true, number: true } });
  if (!order) return null;
  const loaded = await loadOrderForEmail(order.id);
  if (!loaded) return null;
  const documents: CustomerDocumentLink[] = [{ kind: "odustanak", label: "Obrazac za odustanak od ugovora" }];
  if (guaranteeItemsForOrder(loaded.order.items).length) documents.push({ kind: "garancija", label: "Garantni list" });
  const { getIssuedSaleDocumentsForOrder } = await import("@/lib/fiscal/issue");
  const receipts = (await getIssuedSaleDocumentsForOrder(order.id)).filter(d => d.receiptNumber && d.issuedAt);
  receipts.forEach((receipt, index) => documents.push({ kind: "fiskalni", index, label: `Fiskalni račun ${receipt.receiptNumber}` }));
  return { orderNumber: order.number, documents };
}

export async function buildCustomerDocument(orderNumber: string, kind: CustomerDocumentKind, index = 0): Promise<{ filename: string; content: Buffer } | null> {
  const order = await db.order.findUnique({ where: { number: orderNumber }, select: { id: true } });
  if (!order) return null;
  const loaded = await loadOrderForEmail(order.id);
  if (!loaded) return null;
  const o = loaded.order;

  if (kind === "odustanak") {
    const content = await buildWithdrawalFormPdf({
      number: o.id,
      createdAt: new Date(o.createdAt),
      items: o.items.map((item) => ({
        sku: item.sku, name: item.name, qty: item.qty,
        unitPriceSale: item.unitPriceSale, assemblyPrice: item.assemblyPrice ?? null,
      })),
      subtotal: o.subtotal,
      shipping: o.shipping,
      assemblyTotal: o.assemblyTotal,
      voucherCode: o.voucherCode ?? null,
      voucherDiscount: o.voucherDiscount ?? null,
      total: o.total,
      paymentMethod: o.paymentMethod,
      shipping_address: {
        firstName: o.shippingAddress.firstName, lastName: o.shippingAddress.lastName,
        street: o.shippingAddress.street, postalCode: o.shippingAddress.postalCode,
        city: o.shippingAddress.city, companyName: o.shippingAddress.companyName, pib: o.shippingAddress.pib,
      },
      billing_address: o.billingAddress
        ? {
            firstName: o.billingAddress.firstName, lastName: o.billingAddress.lastName,
            street: o.billingAddress.street, postalCode: o.billingAddress.postalCode,
            city: o.billingAddress.city, companyName: o.billingAddress.companyName, pib: o.billingAddress.pib,
          }
        : undefined,
    });
    return { filename: `obrazac-za-odustajanje-${o.id}.pdf`, content };
  }

  if (kind === "garancija") {
    const items = guaranteeItemsForOrder(o.items);
    if (!items.length) return null;
    const content = await buildGuaranteePdf({
      number: o.id,
      createdAt: new Date(o.createdAt),
      items,
      buyer: resolveDocumentBuyerAddress(o.shippingAddress, o.billingAddress),
    });
    return { filename: `garantni-list-${o.id}.pdf`, content };
  }

  const { getIssuedSaleDocumentsForOrder } = await import("@/lib/fiscal/issue");
  const receipts = (await getIssuedSaleDocumentsForOrder(order.id)).filter(d => d.receiptNumber && d.issuedAt);
  const receipt = receipts[index];
  if (!receipt) return null;
  const { renderFiscalReceiptAttachments } = await import("@/lib/fiscal/deliver");
  const [attachment] = await renderFiscalReceiptAttachments(o, [receipt]);
  return { filename: attachment.filename, content: Buffer.from(attachment.content, "base64") };
}
