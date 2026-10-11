import { describe, expect, it } from "vitest";
import { buildSalesInvoiceUbl, readInvoiceXml, type SefInvoiceInput } from "@/lib/sef/ubl";

const party = { name: "Test & firma", pib: "123456789", street: "Ulica 1", city: "Beograd", postalCode: "11000" };
const input: SefInvoiceInput = { number: "FA-2026-1", issueDate: "2026-10-11", dueDate: "2026-10-20", orderNumber: "VP-1", seller: party, buyer: { ...party, pib: "987654321" }, lines: [{ sku: "A", name: "Sto <beli>", qty: 2, unitGross: 1200 }], total: 2520, shipping: 120, assembly: 0, discount: 0 };

describe("SEF UBL boundary", () => {
  it("preserves parties and totals in a Serbian goods invoice", () => {
    const built = buildSalesInvoiceUbl(input), parsed = readInvoiceXml(built.xml);
    expect(parsed).toMatchObject({ number: "FA-2026-1", supplierName: party.name, supplierPib: party.pib, customerPib: "987654321", net: 2100, vat: 420, gross: 2520, currency: "RSD" });
    expect(built.xml).toContain("Sto &lt;beli&gt;");
    expect(built.xml).toContain("srbdt:2022");
  });
  it("applies invoice-level discounts once without changing buyer totals", () => {
    const built = buildSalesInvoiceUbl({ ...input, discount: 120, total: 2400 });
    expect(readInvoiceXml(built.xml)).toMatchObject({ net: 2000, vat: 400, gross: 2400 });
    expect(built.xml).toContain("<cbc:AllowanceTotalAmount currencyID=\"RSD\">100.00");
  });
  it("rejects mismatched money, missing business identity and impossible due dates", () => {
    expect(() => buildSalesInvoiceUbl({ ...input, total: 2 })).toThrow("ukupnom");
    expect(() => buildSalesInvoiceUbl({ ...input, buyer: { ...party, pib: "" } })).toThrow("PIB");
    expect(() => buildSalesInvoiceUbl({ ...input, dueDate: "2026-10-01" })).toThrow("rok");
  });
  it("reads the SEF envelope without confusing its ID with the invoice ID", () => {
    const xml = buildSalesInvoiceUbl(input).xml.replace(/<\?xml[^>]*>/, "");
    const envelope = `<env:DocumentEnvelope xmlns:env="urn:eFaktura:MinFinrs:envelop:schema"><env:DocumentHeader><env:ID>remote-id</env:ID></env:DocumentHeader><env:DocumentBody>${xml}</env:DocumentBody></env:DocumentEnvelope>`;
    expect(readInvoiceXml(envelope).number).toBe(input.number);
  });
  it("reads embedded attachments without fetching external URLs", () => {
    const xml = buildSalesInvoiceUbl(input).xml.replace("<cac:AccountingSupplierParty>", '<cac:AdditionalDocumentReference><cbc:ID>spec</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject filename="spec.csv" mimeCode="text/csv">YTsx</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:AccountingSupplierParty>');
    expect(readInvoiceXml(xml).attachments).toEqual([{ index: 0, filename: "spec.csv", mime: "text/csv", base64: "YTsx" }]);
  });
  it("rejects DTD, HTML, malformed XML and malformed amounts", () => {
    expect(() => readInvoiceXml('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><Invoice/>')).toThrow("nedozvoljene");
    expect(() => readInvoiceXml("<html>login</html>")).toThrow("UBL");
    expect(() => readInvoiceXml(buildSalesInvoiceUbl(input).xml.replace("2520.00</cbc:TaxInclusiveAmount>", "abc</cbc:TaxInclusiveAmount>"))).toThrow("iznosi");
  });
});
