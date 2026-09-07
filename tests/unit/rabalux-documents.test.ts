import { describe, expect, it } from "vitest";
import {
  assertRabaluxSupplierAttachmentSet,
  assertRabaluxSupplierOrderAttachmentSet,
  buildRabaluxPackingPdf,
  buildRabaluxSupplierOrderAttachments,
  buildRabaluxSupplierOrderPdf,
} from "@/lib/rabalux/documents";

const supplierDocumentInput = {
  orderNumber: "SPC-2026-000123",
  createdAt: new Date("2026-09-04T10:00:00.000Z"),
  items: [{ externalSku: "7996", name: "Rabalux plafonjera", qty: 2 }],
  shippingAddress: {
    firstName: "Test",
    lastName: "Kupac",
    street: "Test ulica 1",
    postalCode: "11000",
    city: "Beograd",
  },
};

describe("Rabalux packing document", () => {
  it("contains only supplier lines and no commercial prices", () => {
    const pdf = buildRabaluxPackingPdf({
      orderNumber: "SPC-2026-000123",
      items: [{ externalSku: "7996", name: "Rabalux plafonjera", qty: 2 }],
    });
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw).toContain("7996");
    expect(raw).toContain("Rabalux plafonjera");
    expect(raw).not.toContain("12999");
    expect(raw).not.toContain("DC-ARTIKAL");
    expect(raw).not.toMatch(/garant|predracun|predračun/i);
  });

  it("allows exactly one waybill and one packing list", () => {
    const attachments = [
      {
        filename: "adresnica-SPC-2026-000123.pdf",
        content: "label",
        contentType: "application/pdf",
      },
      {
        filename: "pak-lista-SPC-2026-000123.pdf",
        content: "packing",
        contentType: "application/pdf",
      },
    ];
    expect(() => assertRabaluxSupplierAttachmentSet(attachments)).not.toThrow();
    expect(() =>
      assertRabaluxSupplierAttachmentSet([
        ...attachments,
        {
          filename: "garantni-list-SPC-2026-000123.pdf",
          content: "guarantee",
          contentType: "application/pdf",
        },
      ]),
    ).toThrow(/samo adresnica i packing lista/i);
  });

  it("builds the Rabalux-only proforma in the customer design and without commercial data", async () => {
    const pdf = await buildRabaluxSupplierOrderPdf(supplierDocumentInput);
    const raw = pdf.toString("latin1");
    expect(raw).toContain("/Subtype /Image");
    expect(raw).toContain("/MediaBox [0 0 595 842]");
    expect(pdf.length).toBeGreaterThan(20_000);

    const attachments = await buildRabaluxSupplierOrderAttachments(
      supplierDocumentInput,
    );
    expect(attachments.map((attachment) => attachment.filename)).toEqual([
      "predracun-rabalux-SPC-2026-000123.pdf",
      "obrazac-za-odustajanje-SPC-2026-000123.pdf",
    ]);
    const withdrawal = Buffer.from(attachments[1]!.content, "base64").toString(
      "latin1",
    );
    expect(withdrawal).toContain("Test Kupac");
    expect(withdrawal).toContain("7996");
    expect(withdrawal).not.toContain("DC-ARTIKAL");
  });

  it("rejects extra attachments from the initial supplier order", async () => {
    const attachments = await buildRabaluxSupplierOrderAttachments(
      supplierDocumentInput,
    );
    expect(() =>
      assertRabaluxSupplierOrderAttachmentSet(attachments),
    ).not.toThrow();
    expect(() =>
      assertRabaluxSupplierOrderAttachmentSet([
        ...attachments,
        {
          filename: "kupac-puni-predracun.pdf",
          content: "forbidden",
          contentType: "application/pdf",
        },
      ]),
    ).toThrow(/samo Rabalux primerak predracuna/i);
  });
});
