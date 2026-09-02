import { describe, expect, it } from "vitest";
import {
  assertRabaluxSupplierAttachmentSet,
  buildRabaluxPackingPdf,
} from "@/lib/rabalux/documents";

describe("Rabalux packing document", () => {
  it("contains only supplier lines and no commercial prices", () => {
    const pdf = buildRabaluxPackingPdf({
      orderNumber: "SPC-2026-000123",
      items: [
        { externalSku: "7996", name: "Rabalux plafonjera", qty: 2 },
      ],
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
});
