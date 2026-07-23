import "server-only";

import { buildPdf } from "@/lib/email/pdf";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export type PurchaseOrderPdfInput = {
  number: string;
  orderDate: Date | null;
  loadingDate?: Date | null;
  deliveryDate?: Date | null;
  currency: string;
  exchangeRate: number;
  freightCurrency?: string;
  freightExchangeRate: number;
  freightCost: number;
  totalPrice: number;
  totalVolume: number;
  totalWeight: number;
  parity?: string | null;
  transportType?: string | null;
  bmPct?: unknown;
  notes?: string | null;
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
    currency?: string;
    totalVolume: number;
    totalWeight: number;
    customsRate: number;
    calcRetailPrice: number | null;
    bmPct: number | null;
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
  lines.push(
    { text: "" },
    {
      text: `Utovar: ${order.loadingDate?.toLocaleDateString("sr-Latn-RS") ?? "—"} | Isporuka: ${order.deliveryDate?.toLocaleDateString("sr-Latn-RS") ?? "—"}`,
    },
    {
      text: `Paritet: ${order.parity ?? "—"} | Transport: ${order.transportType ?? "—"}`,
    },
    { text: "" },
    { text: "Stavke:", bold: true },
  );
  for (const item of order.items) {
    lines.push({
      text: `${item.sku} | ${item.name} | ${item.qty} x ${money(item.purchasePrice, item.currency ?? order.currency)} = ${money(item.purchasePrice * item.qty, item.currency ?? order.currency)} | ${item.totalVolume.toFixed(3)} m3 | ${item.totalWeight.toFixed(3)} kg | carina ${item.customsRate.toFixed(2)}% | MPC ${item.calcRetailPrice == null ? "—" : money(item.calcRetailPrice, "RSD")} | BM ${item.bmPct == null ? "—" : `${item.bmPct.toFixed(2)}%`}`,
    });
  }
  lines.push(
    { text: "" },
    { text: `Roba: ${money(order.totalPrice, order.currency)}` },
    {
      text: `Kurs ${order.currency}: ${order.exchangeRate.toFixed(6)} RSD`,
    },
    {
      text: `Transport: ${money(order.freightCost, order.freightCurrency ?? order.currency)} (kurs ${order.freightExchangeRate.toFixed(6)})`,
    },
    {
      text: `Zapremina: ${order.totalVolume.toFixed(3)} m3 | Težina: ${order.totalWeight.toFixed(3)} kg`,
    },
    {
      text: `Ukupna BM: ${order.bmPct == null ? "—" : `${Number(order.bmPct).toFixed(2)}%`}`,
    },
    {
      text: `Ukupna nabavna vrednost: ${money(order.totalPrice, order.currency)}`,
      bold: true,
      size: 13,
    },
  );
  if (order.notes) {
    lines.push({ text: "" }, { text: `Napomena: ${order.notes}` });
  }
  return buildPdf(`Porudžbenica ${order.number}`, lines);
}
