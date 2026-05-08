import "server-only";

import { buildPdf } from "@/lib/email/pdf";

/**
 * Phase 4F — Fiscal receipt PDF.
 *
 * Mirrors the LPFR slip layout: header (merchant TIN + location), line
 * items with qty × price, totals, payment method, fiscal receipt number
 * and the QR fallback URL. Uses the same primitive `buildPdf` helper as
 * the order confirmation attachments so we don't add another dep.
 */

export interface FiscalReceiptPdfInput {
  orderNumber: string;
  receiptNumber: string;
  fiscalizedAt: Date;
  merchant: {
    name: string;
    tin: string;
    locationId: string;
    address?: string;
  };
  buyer?: {
    name?: string;
    tin?: string;
    address?: string;
  };
  items: {
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
  }[];
  total: number;
  paymentMethodLabel: string;
  qrUrl: string | null;
}

const fmt = (n: number) =>
  `${n.toLocaleString("sr-Latn-RS").replace(/\u00A0/g, " ")} RSD`;

export function buildFiscalReceiptPdf(input: FiscalReceiptPdfInput): Buffer {
  const lines: { text: string; bold?: boolean; size?: number; spaceAbove?: number }[] = [
    { text: `Fiskalni račun broj ${input.receiptNumber}`, bold: true, size: 13 },
    { text: `Porudžbina: ${input.orderNumber}` },
    { text: `Datum: ${input.fiscalizedAt.toLocaleString("sr-Latn-RS")}` },
    { text: "" },
    { text: "Prodavac:", bold: true },
    { text: input.merchant.name },
    { text: `PIB: ${input.merchant.tin} · Poslovni prostor: ${input.merchant.locationId}` },
  ];
  if (input.merchant.address) lines.push({ text: input.merchant.address });

  if (input.buyer && (input.buyer.name || input.buyer.tin)) {
    lines.push({ text: "" });
    lines.push({ text: "Kupac:", bold: true });
    if (input.buyer.name) lines.push({ text: input.buyer.name });
    if (input.buyer.tin) lines.push({ text: `PIB: ${input.buyer.tin}` });
    if (input.buyer.address) lines.push({ text: input.buyer.address });
  }

  lines.push({ text: "" });
  lines.push({ text: "Stavke:", bold: true, spaceAbove: 4 });
  for (const it of input.items) {
    lines.push({
      text: `${it.qty} x ${it.name} (${it.sku}) — ${fmt(it.unitPrice * it.qty)}`,
    });
  }

  lines.push({ text: "" });
  lines.push({
    text: `Ukupno: ${fmt(input.total)}`,
    bold: true,
    size: 13,
    spaceAbove: 6,
  });
  lines.push({ text: `Način plaćanja: ${input.paymentMethodLabel}` });

  if (input.qrUrl) {
    lines.push({ text: "" });
    lines.push({ text: "Provera računa:", bold: true });
    lines.push({ text: input.qrUrl });
  }

  lines.push({ text: "" });
  lines.push({
    text: "Hvala na poverenju! Za reklamacije: reklamacije@svetpovoljnihcena.rs",
  });

  return buildPdf("Fiskalni račun", lines);
}
