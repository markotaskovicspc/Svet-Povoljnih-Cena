import "server-only";

import { db } from "@/lib/db";
import { buildPdf } from "@/lib/email/pdf";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";
import { calculateSalesLineTotals } from "@/lib/admin/sales-order";

export async function getVpProformaData(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { registrationNumber: true } },
      priceList: { select: { currency: true } },
      items: { orderBy: { id: "asc" } },
    },
  });
}

type VpProformaData = NonNullable<
  Awaited<ReturnType<typeof getVpProformaData>>
>;

function money(value: number, currency: string) {
  return `${value.toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function customerName(order: VpProformaData) {
  return (
    order.shipCompanyName?.trim() ||
    [order.shipFirstName, order.shipLastName].filter(Boolean).join(" ").trim() ||
    "Kupac"
  );
}

export function buildVpProformaPdf(order: VpProformaData) {
  if (order.channel !== "VP") {
    throw new Error("VP predračun je dostupan samo za veleprodajnu porudžbinu.");
  }
  if (!order.shipCompanyName?.trim() || !order.shipPib?.trim()) {
    throw new Error("VP predračun zahteva naziv firme i PIB kupca.");
  }
  const currency = order.priceList?.currency ?? "RSD";
  const issuedAt = new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeZone: "Europe/Belgrade",
  }).format(new Date());
  const lines: Array<{
    text: string;
    bold?: boolean;
    size?: number;
    spaceAbove?: number;
  }> = [
    { text: `Broj: ${order.number}`, bold: true, size: 13 },
    { text: `Datum izdavanja: ${issuedAt}` },
    { text: "Dokument nije fiskalni račun niti elektronska faktura.", bold: true },
    { text: "", spaceAbove: 6 },
    { text: "Prodavac", bold: true, size: 13 },
    { text: MERCHANT_LEGAL_INFO.name },
    {
      text: `PIB ${MERCHANT_LEGAL_INFO.pib} | MB ${MERCHANT_LEGAL_INFO.registrationNumber}`,
    },
    { text: MERCHANT_LEGAL_INFO.shortAddress },
    {
      text: `Tekući račun ${MERCHANT_LEGAL_INFO.bankAccount} (${MERCHANT_LEGAL_INFO.bankName})`,
    },
    { text: "", spaceAbove: 6 },
    { text: "Kupac", bold: true, size: 13 },
    { text: customerName(order), bold: true },
    {
      text: `PIB ${order.shipPib} | MB ${order.customer?.registrationNumber ?? "—"}`,
    },
    {
      text: `${order.shipStreet}, ${order.shipPostalCode} ${order.shipCity}, ${order.shipCountry}`,
    },
    { text: "", spaceAbove: 6 },
    { text: "Stavke", bold: true, size: 13 },
  ];

  let totalNet = 0;
  let totalVat = 0;
  let totalGross = 0;
  order.items.forEach((item, index) => {
    const unitPrice = Number(item.unitPriceSale);
    const totals = calculateSalesLineTotals(item.qty, unitPrice);
    totalNet += totals.totalNet;
    totalVat += totals.totalVat;
    totalGross += totals.totalGross;
    lines.push({
      text: `${index + 1}. ${item.sku} | ${item.shortNameSnapshot ?? item.name} | ${item.qty} kom x ${money(unitPrice, currency)} | ${money(totals.totalGross, currency)}`,
      bold: true,
      spaceAbove: 3,
    });
    lines.push({
      text: `   Osnovica ${money(totals.totalNet, currency)} | PDV 20% ${money(totals.totalVat, currency)}`,
      size: 9,
    });
  });

  lines.push(
    { text: "", spaceAbove: 8 },
    { text: `Ukupno bez PDV-a: ${money(totalNet, currency)}` },
    { text: `PDV 20%: ${money(totalVat, currency)}` },
    {
      text: `Ukupno za uplatu: ${money(totalGross, currency)}`,
      bold: true,
      size: 14,
    },
    { text: `Poziv na broj: ${order.number.replaceAll("-", "")}` },
    { text: "Rok važenja predračuna: 7 dana." },
  );

  return buildPdf(`VP predračun ${order.number}`, lines);
}
