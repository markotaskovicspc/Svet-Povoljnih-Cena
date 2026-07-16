import "server-only";

import { buildPdf } from "@/lib/email/pdf";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export type PurchaseOrderPdfInput = {
  number: string;
  orderDate: Date | null;
  currency: string;
  freightCost: number;
  totalPrice: number;
  supplier: {
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
  } | null;
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    purchasePrice: number;
  }>;
};

const money = (value: number, currency: string) =>
  `${value.toLocaleString("sr-Latn-RS").replace(/\u00a0/g, " ")} ${currency}`;

export function buildPurchaseOrderPdf(order: PurchaseOrderPdfInput) {
  const lines: Array<{
    text: string;
    bold?: boolean;
    size?: number;
    spaceAbove?: number;
  }> = [
    {
      text: `Datum: ${(order.orderDate ?? new Date()).toLocaleDateString("sr-Latn-RS")}`,
    },
    { text: "" },
    { text: "Kupac:", bold: true },
    { text: MERCHANT_LEGAL_INFO.name },
    { text: `PIB: ${MERCHANT_LEGAL_INFO.pib}` },
    { text: MERCHANT_LEGAL_INFO.shortAddress },
    { text: "" },
    { text: "Dobavljač:", bold: true },
    { text: order.supplier?.name ?? "Nije izabran" },
  ];
  const supplierAddress = [
    order.supplier?.address,
    order.supplier?.city,
    order.supplier?.country,
  ]
    .filter(Boolean)
    .join(", ");
  if (supplierAddress) lines.push({ text: supplierAddress });
  lines.push({ text: "" }, { text: "Stavke:", bold: true });
  for (const item of order.items) {
    lines.push({
      text: `${item.sku} | ${item.name} | ${item.qty} x ${money(item.purchasePrice, order.currency)} = ${money(item.purchasePrice * item.qty, order.currency)}`,
    });
  }
  lines.push(
    { text: "" },
    { text: `Roba: ${money(order.totalPrice, order.currency)}` },
    { text: `Transport: ${money(order.freightCost, order.currency)}` },
    {
      text: `Ukupna nabavna vrednost: ${money(order.totalPrice + order.freightCost, order.currency)}`,
      bold: true,
      size: 13,
    },
  );
  return buildPdf(`Porudžbenica ${order.number}`, lines);
}
