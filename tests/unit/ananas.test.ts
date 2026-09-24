import { afterEach, describe, expect, it, vi } from "vitest";
import { ananasDateRange, normalizeAnanasDocument, safeAnanasPdfUrl } from "@/lib/ananas/documents";
import { AnanasClient } from "@/lib/ananas/client";

function receipt() {
  return {
    invoiceHeader: { invoiceType: "FISCAL", merchantDetails: { taxIdentificationNumber: "115085587" }, customerDetails: { email: "private@example.com" },
      fiscalDetails: { invoiceNumber: "F-1", fiscalInvoiceDate: "2026-09-23T12:00:00", referentDocumentNumber: "ORIGINAL-1" },
      orderDetails: { invoiceId: "doc-1", orderId: "A-1", suborderId: "A-1-1", invoicedDate: "2026-09-23T12:00:00Z", paymentMethods: ["COD"] } },
    productSpecification: { items: [{ productDetails: { sku: "SKU-1", name: "Artikal" }, quantity: 2, grandTotalPrice: { basePrice: 1200 } }], totalDetails: { basePrice: 1200, basePriceWithoutVat: 1000 } },
  };
}
afterEach(() => vi.unstubAllEnvs());
describe("Ananas document import", () => {
  it("normalizes money and UTC date without retaining buyer PII", () => {
    const result = normalizeAnanasDocument(receipt(), "SALE", "115085587");
    expect(result).toMatchObject({ externalId: "doc-1", gross: 1200, net: 1000, vat: 200, issuedAt: new Date("2026-09-23T12:00:00Z") });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });
  it("normalizes negative refund amounts and requires the original reference", () => {
    const raw = receipt(); raw.productSpecification.totalDetails = { basePrice: -1200, basePriceWithoutVat: -1000 };
    expect(normalizeAnanasDocument(raw, "REFUND", "115085587")).toMatchObject({ gross: 1200, net: 1000, vat: 200 });
    raw.invoiceHeader.fiscalDetails.referentDocumentNumber = "";
    expect(() => normalizeAnanasDocument(raw, "REFUND", "115085587")).toThrow(/referencu/);
    expect(() => normalizeAnanasDocument(raw, "SALE", "115085587")).toThrow(/negativan/);
  });
  it("rejects another merchant, a nonfiscal document and impossible totals", () => {
    expect(() => normalizeAnanasDocument(receipt(), "SALE", "OTHER")).toThrow(/PIB/);
    const raw = receipt(); raw.invoiceHeader.invoiceType = "INVOICE";
    expect(() => normalizeAnanasDocument(raw, "SALE", "115085587")).toThrow(/nefiskalni/);
    raw.invoiceHeader.invoiceType = "FISCAL"; raw.productSpecification.totalDetails.basePriceWithoutVat = 1500;
    expect(() => normalizeAnanasDocument(raw, "SALE", "115085587")).toThrow(/Neto/);
  });
  it("bounds import ranges, including a 31-day period across DST", () => {
    expect(() => ananasDateRange("2026-10-01T00:00:00+02:00", "2026-11-01T00:00:00+01:00")).not.toThrow();
    expect(() => ananasDateRange("2026-09-01", "2026-11-01")).toThrow();
    expect(() => ananasDateRange("bad", "bad")).toThrow();
  });
  it("permits private signed provider links but rejects deceptive domains and unsafe schemes", () => {
    expect(safeAnanasPdfUrl("https://bucket.s3.eu-central-1.amazonaws.com/a?signature=x")).toContain("signature=x");
    for (const url of ["https://ananas.rs.evil.test/a", "http://ananas.rs/a", "https://user:pass@ananas.rs/a", "javascript:alert(1)"]) expect(() => safeAnanasPdfUrl(url)).toThrow();
  });
});
describe("Ananas read-only API client", () => {
  function access() { vi.stubEnv("ANANAS_CLIENT_ID", "test-client"); vi.stubEnv("ANANAS_CLIENT_SECRET", "secret-never-logged"); }
  it("refreshes an expired token once and requests only fiscal documents with inclusive end", async () => {
    access();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "first-token-value" }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: "second-token-value" }))
      .mockResolvedValueOnce(Response.json([receipt()]));
    const result = await new AnanasClient(request).documents("SALE", new Date("2026-09-01Z"), new Date("2026-09-02Z"));
    expect(result).toHaveLength(1);
    const url = new URL(String(request.mock.calls[3][0]));
    expect(url.pathname).toBe("/order/api/v1/merchant-integration/invoices");
    expect(url.searchParams.get("dateTo")).toBe("2026-09-01T23:59:59.999Z");
    expect(url.searchParams.get("type")).toBe("FISCAL");
    expect(request.mock.calls[3][1]?.headers).toMatchObject({ Authorization: "Bearer second-token-value" });
  });
  it("reports HTTP failures without reflecting provider bodies or credentials", async () => {
    access();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-never-logged", { status: 403 }));
    await expect(new AnanasClient(request).documents("SALE", new Date(), new Date())).rejects.toThrow("HTTP 403");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("matches the exact correction document instead of opening another receipt", async () => {
    access();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: "token-value-long" })).mockResolvedValueOnce(Response.json({ "A-1": [{ documentCorrelationId: "wrong", link: "https://ananas.rs/wrong" }, { documentCorrelationId: "wanted", link: "https://ananas.rs/right" }] }));
    expect(await new AnanasClient(request).pdf("REFUND", "A-1", "wanted")).toBe("https://ananas.rs/right");
    expect(String(request.mock.calls[1][0])).toContain("/invoice-corrections/urls?");
  });
});
