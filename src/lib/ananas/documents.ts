import { z } from "zod";

const record = z.record(z.string(), z.unknown());
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
function required(value: unknown, field: string) {
  const result = text(value);
  if (!result || result.length > 200) throw new Error(`Ananas dokument nema ispravno polje ${field}.`);
  return result;
}
function amount(value: unknown) {
  if ((typeof value !== "number" && typeof value !== "string") || text(value) === "") throw new Error("Ananas dokument nema iznos.");
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e12) throw new Error("Neispravan Ananas iznos.");
  return Math.round(Math.abs(result) * 100) / 100;
}
function utcDate(value: unknown) {
  const raw = required(value, "datum");
  const result = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(result.getTime())) throw new Error("Neispravan datum Ananas računa.");
  return result;
}
export function normalizeAnanasDocument(input: unknown, kind: "SALE" | "REFUND", merchantTin: string) {
  const root = record.parse(input);
  const header = record.parse(root.invoiceHeader);
  if (header.invoiceType !== "FISCAL") throw new Error("Ananas je vratio nefiskalni dokument; uvoz je zaustavljen.");
  const merchant = record.parse(header.merchantDetails);
  if (text(merchant.taxIdentificationNumber) !== merchantTin) throw new Error("PIB Ananas dokumenta ne odgovara SPC nalogu; uvoz je zaustavljen.");
  const fiscal = record.parse(header.fiscalDetails);
  const order = record.parse(header.orderDetails);
  const products = record.parse(root.productSpecification);
  const totals = record.parse(products.totalDetails ?? products.grandTotalDetails ?? products.GrandTotalDetails);
  if (kind === "SALE" && (Number(totals.basePrice) < 0 || Number(totals.basePriceWithoutVat) < 0)) throw new Error("Ananas prodajni račun ima negativan iznos.");
  const gross = amount(totals.basePrice);
  const net = amount(totals.basePriceWithoutVat);
  if (net > gross + 0.01) throw new Error("Neto iznos Ananas računa veći je od bruto iznosa.");
  const items = z.array(record).parse(products.items).map(item => {
    const product = record.parse(item.productDetails);
    const price = record.parse(item.grandTotalPrice);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) throw new Error("Neispravna količina Ananas stavke.");
    return { sku: text(product.sku), name: text(product.name).slice(0, 500), quantity: Math.abs(quantity), gross: amount(price.basePrice) };
  });
  const fiscalNumber = required(fiscal.invoiceNumber, "broj fiskalnog računa");
  const externalId = required(order.invoiceId ?? order.invoiceid ?? order.invoiceNumber ?? fiscalNumber, "ID dokumenta");
  const reference = text(fiscal.referentDocumentNumber);
  if (kind === "REFUND" && !reference) throw new Error("Ananas korekcija nema referencu na originalni račun.");
  return {
    kind, externalId, fiscalNumber, reference: reference || null,
    orderNumber: required(order.orderId, "porudžbina"), suborderNumber: required(order.suborderId, "potporudžbina"),
    issuedAt: utcDate(fiscal.fiscalInvoiceDate), invoicedAt: utcDate(order.invoicedDate),
    gross, net, vat: Math.round((gross - net) * 100) / 100,
    paymentMethods: Array.isArray(order.paymentMethods) ? order.paymentMethods.map(text).join(", ") : text(order.paymentMethods),
    items,
  };
}

export function safeAnanasPdfUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("PDF link nije dostupan.");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(host === "ananas.rs" || host.endsWith(".ananas.rs") || host.endsWith(".amazonaws.com"))) throw new Error("Ananas je vratio neočekivan PDF domen.");
  return url.toString();
}

export function ananasDateRange(from: string, to: string) {
  const start = new Date(from), end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 31 * 86400000 + 3600000) throw new Error("Za jedan uvoz izaberite period do 31 dana.");
  return { start, end };
}
