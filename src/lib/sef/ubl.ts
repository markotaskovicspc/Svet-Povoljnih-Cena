import { DOMParser } from "@xmldom/xmldom";

const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const INV = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const esc = (v: string) => v.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export type SefParty = { name: string; pib: string; registrationNumber?: string; street: string; city: string; postalCode: string };
export type SefInvoiceInput = { number: string; issueDate: string; dueDate: string; orderNumber: string; seller: SefParty; buyer: SefParty; total: number; lines: { sku: string; name: string; qty: number; unitGross: number }[]; shipping: number; assembly: number; discount: number };

function party(tag: string, p: SefParty) {
  if (!/^\d{9}$/.test(p.pib) || !p.name.trim() || !p.street.trim() || !p.city.trim() || !p.postalCode.trim()) throw new Error("Faktura zahteva naziv, PIB i kompletnu adresu obe firme.");
  return `<cac:${tag}><cac:Party><cbc:EndpointID schemeID="9948">${p.pib}</cbc:EndpointID><cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>${esc(p.street)}</cbc:StreetName><cbc:CityName>${esc(p.city)}</cbc:CityName><cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>RS</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>RS${p.pib}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName><cbc:CompanyID>${esc(p.registrationNumber || p.pib)}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:${tag}>`;
}

/** Domestic RSD goods invoice, using the application's existing 20% gross prices. */
export function buildSalesInvoiceUbl(input: SefInvoiceInput) {
  for (const date of [input.issueDate, input.dueDate]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("Neispravan datum fakture.");
  if (input.dueDate < input.issueDate || !input.number.trim() || input.number.length > 22) throw new Error("Proverite broj (do 22 znaka) i rok plaćanja fakture.");
  if (!input.lines.length || input.lines.some(l => !l.name.trim() || !Number.isSafeInteger(l.qty) || l.qty <= 0 || !Number.isFinite(l.unitGross) || l.unitGross < 0)) throw new Error("Neispravne stavke fakture.");
  if (![input.shipping, input.assembly, input.discount, input.total].every(v => Number.isFinite(v) && v >= 0) || input.total === 0) throw new Error("Neispravni iznosi fakture.");
  const lines = [...input.lines];
  if (input.shipping) lines.push({ sku: "DOSTAVA", name: "Dostava", qty: 1, unitGross: input.shipping });
  if (input.assembly) lines.push({ sku: "MONTAZA", name: "Montaža", qty: 1, unitGross: input.assembly });
  const grossBefore = round(lines.reduce((s, l) => s + l.qty * l.unitGross, 0));
  if (Math.abs(round(grossBefore - input.discount) - input.total) > .01) throw new Error("Zbir stavki, dostave i popusta ne odgovara ukupnom iznosu naloga.");
  const netLines = lines.map(l => ({ ...l, net: round(l.qty * l.unitGross / 1.2) }));
  const lineNet = round(netLines.reduce((s, l) => s + l.net, 0));
  const allowance = round(input.discount / 1.2);
  const net = round(lineNet - allowance);
  const vat = round(net * .2);
  const gross = round(net + vat);
  const rounding = round(input.total - gross);
  if (Math.abs(rounding) > .05) throw new Error("Zaokruživanje iznosa zahteva proveru fakture.");
  const amount = (n: number) => n.toFixed(2);
  const taxCategory = '<cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="${INV}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}"><cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:mfin.gov.rs:srbdt:2022</cbc:CustomizationID><cbc:ID>${esc(input.number)}</cbc:ID><cbc:IssueDate>${input.issueDate}</cbc:IssueDate><cbc:DueDate>${input.dueDate}</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>RSD</cbc:DocumentCurrencyCode><cac:InvoicePeriod><cbc:DescriptionCode>35</cbc:DescriptionCode></cac:InvoicePeriod><cac:OrderReference><cbc:ID>${esc(input.orderNumber)}</cbc:ID></cac:OrderReference>${party("AccountingSupplierParty", input.seller)}${party("AccountingCustomerParty", input.buyer)}${allowance ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Popust</cbc:AllowanceChargeReason><cbc:Amount currencyID="RSD">${amount(allowance)}</cbc:Amount>${taxCategory}</cac:AllowanceCharge>` : ""}<cac:TaxTotal><cbc:TaxAmount currencyID="RSD">${amount(vat)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="RSD">${amount(net)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="RSD">${amount(vat)}</cbc:TaxAmount>${taxCategory}</cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="RSD">${amount(lineNet)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="RSD">${amount(net)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="RSD">${amount(gross)}</cbc:TaxInclusiveAmount>${allowance ? `<cbc:AllowanceTotalAmount currencyID="RSD">${amount(allowance)}</cbc:AllowanceTotalAmount>` : ""}${rounding ? `<cbc:PayableRoundingAmount currencyID="RSD">${amount(rounding)}</cbc:PayableRoundingAmount>` : ""}<cbc:PayableAmount currencyID="RSD">${amount(input.total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${netLines.map((l, i) => `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="H87">${l.qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="RSD">${amount(l.net)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${esc(l.name)}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${esc(l.sku)}</cbc:ID></cac:SellersItemIdentification><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="RSD">${(l.net / l.qty).toFixed(6)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join("")}</Invoice>`;
  return { xml, net, vat, gross: input.total };
}

export function readInvoiceXml(xml: string) {
  if (Buffer.byteLength(xml) > 10 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("SEF XML je prevelik ili sadrži nedozvoljene deklaracije.");
  let invalid = false;
  const doc = new DOMParser({ errorHandler: { warning: () => { invalid = true; }, error: () => { invalid = true; }, fatalError: () => { invalid = true; } } }).parseFromString(xml, "application/xml");
  const invoice = doc.getElementsByTagNameNS(INV, "Invoice").item(0);
  if (invalid || !invoice) throw new Error("SEF dokument nije ispravan UBL račun.");
  const direct = (parent: Element, ns: string, name: string): Element | null => Array.from(parent.childNodes).find(n => n.nodeType === 1 && (n as Element).localName === name && (n as Element).namespaceURI === ns) as Element | undefined ?? null;
  const text = (parent: Element, name: string) => direct(parent, CBC, name)?.textContent?.trim() ?? "";
  const aggregate = (parent: Element, name: string) => direct(parent, CAC, name);
  const partyData = (name: string) => {
    const p = aggregate(invoice as unknown as Element, name)?.getElementsByTagNameNS(CAC, "Party").item(0);
    if (!p) throw new Error("SEF račun nema podatke o firmi.");
    const tax = p.getElementsByTagNameNS(CAC, "PartyTaxScheme").item(0);
    const pib = (tax?.getElementsByTagNameNS(CBC, "CompanyID").item(0)?.textContent || p.getElementsByTagNameNS(CBC, "EndpointID").item(0)?.textContent || "").replace(/^RS/i, "").trim();
    const legal = p.getElementsByTagNameNS(CBC, "RegistrationName").item(0)?.textContent || p.getElementsByTagNameNS(CBC, "Name").item(0)?.textContent || "";
    if (!/^\d{9}$/.test(pib) || !legal.trim()) throw new Error("SEF račun nema naziv firme ili PIB.");
    return { name: legal.trim(), pib };
  };
  const root = invoice as unknown as Element;
  const totals = aggregate(root, "LegalMonetaryTotal");
  if (!totals) throw new Error("SEF račun nema ukupan iznos.");
  const net = Number(text(totals, "TaxExclusiveAmount"));
  const gross = Number(text(totals, "TaxInclusiveAmount"));
  if (!text(totals, "TaxExclusiveAmount") || !text(totals, "TaxInclusiveAmount") || ![net, gross].every(Number.isFinite)) throw new Error("Neispravni iznosi SEF računa.");
  const issueDate = text(root, "IssueDate");
  const dueDate = text(root, "DueDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !Number.isFinite(Date.parse(issueDate)) || dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)))) throw new Error("Neispravan datum SEF računa.");
  const number = text(root, "ID");
  if (!number) throw new Error("Nedostaje broj SEF računa.");
  const supplier = partyData("AccountingSupplierParty"), customer = partyData("AccountingCustomerParty");
  const binaries = Array.from(invoice.getElementsByTagNameNS(CBC, "EmbeddedDocumentBinaryObject"));
  const attachments = binaries.map((el, index) => ({ index, filename: (el.getAttribute("filename") || `prilog-${index + 1}`).replace(/[^\p{L}\p{N}._-]/gu, "_"), mime: el.getAttribute("mimeCode") || "application/octet-stream", base64: (el.textContent || "").replace(/\s/g, "") }));
  if (attachments.some(a => a.base64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64))) throw new Error("Neispravan prilog SEF računa.");
  return { number, issueDate: new Date(issueDate + "T00:00:00Z"), dueDate: dueDate ? new Date(dueDate + "T00:00:00Z") : null, supplierName: supplier.name, supplierPib: supplier.pib, customerName: customer.name, customerPib: customer.pib, currency: text(root, "DocumentCurrencyCode"), net, vat: round(gross - net), gross, attachments };
}
