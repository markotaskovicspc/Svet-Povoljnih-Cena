import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  nextAvailableArticleSku,
  normalizeArticleSku,
  numericArticleSku,
} from "@/lib/article-sku";
import { articleSearchWhere } from "@/lib/admin/article-search";
import {
  DEFAULT_DELIVERY_WINDOWS,
  resolveDeliveryWindowForQuantity,
} from "@/lib/delivery-windows";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";
import { productNewUntilIsActive } from "@/lib/product-newness";
import {
  convertDocxDescription,
  validateProductDocument,
} from "@/lib/product-documents.server";

describe("unos artikala", () => {
  it("trimuje ručni SKU i odbija praznine i kontrolne znakove", () => {
    expect(normalizeArticleSku("  ABC-123  ")).toBe("ABC-123");
    expect(() => normalizeArticleSku("ABC 123")).toThrow(/razmake/i);
    expect(() => normalizeArticleSku("ABC\u0000")).toThrow(/kontrolni/i);
  });

  it("dodeljuje najmanju slobodnu šifru veću od 100000", () => {
    expect(nextAvailableArticleSku([])).toBe("100001");
    expect(
      nextAvailableArticleSku([
        "100001",
        "100.002",
        "100004",
        "NOV-2026-00001",
        "100000",
      ]),
    ).toBe("100003");
  });

  it("tretira tačkaste i netačkaste numeričke šifre kao isti broj", () => {
    expect(numericArticleSku("100.001")).toBe(100001);
    expect(numericArticleSku("100001")).toBe(100001);
    expect(numericArticleSku("10.00.1")).toBeNull();
    expect(numericArticleSku("LEGACY-100001")).toBeNull();
  });

  it("ograničava pretragu na SKU kada je izabrana Šifra", () => {
    expect(articleSearchWhere("abc", "sku")).toEqual({
      sku: { contains: "abc", mode: "insensitive" },
    });
    expect(articleSearchWhere("abc", "sku")).not.toHaveProperty("OR");
    expect(articleSearchWhere("abc")).toHaveProperty("OR");
  });

  it("uzima važeću RETAIL stavku pre legacy Product.fullPrice", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const resolved = resolveRetailPrice(
      [
        {
          price: 12_990,
          validFrom: new Date("2026-07-01T00:00:00.000Z"),
          validTo: null,
          priceList: {
            id: "mp",
            name: "MP",
            code: "MP",
            active: true,
            validFrom: null,
            validTo: null,
          },
        },
      ],
      15_000,
      now,
    );
    expect(resolved.price).toBe(12_990);
    expect(resolved.source.type).toBe("PRICE_LIST");
  });

  it("izvodi oznaku Novo samo iz datuma newUntil", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(productNewUntilIsActive(null, now)).toBe(false);
    expect(productNewUntilIsActive(new Date("2026-07-29T00:00:00.000Z"), now)).toBe(
      true,
    );
    expect(productNewUntilIsActive(new Date("2026-07-28T00:00:00.000Z"), now)).toBe(
      false,
    );
  });

  it("bira DC rok samo kada DC može da ispuni traženu količinu", () => {
    expect(
      resolveDeliveryWindowForQuantity(
        { quantity: 2, dcAvailable: 2, supplierAvailable: 8 },
        DEFAULT_DELIVERY_WINDOWS,
      ),
    ).toEqual({ min: 3, max: 5 });
    expect(
      resolveDeliveryWindowForQuantity(
        { quantity: 3, dcAvailable: 2, supplierAvailable: 8 },
        DEFAULT_DELIVERY_WINDOWS,
      ),
    ).toEqual({ min: 5, max: 8 });
  });
});

describe("PDP dokumenti", () => {
  it("prihvata PDF samo kada ekstenzija, MIME i potpis odgovaraju", async () => {
    const pdf = new File([Buffer.from("%PDF-1.7\n")], "deklaracija.pdf", {
      type: "application/pdf",
    });
    await expect(validateProductDocument(pdf)).resolves.toMatchObject({
      extension: "pdf",
      mimeType: "application/pdf",
    });

    const disguised = new File([Buffer.from("<html>unsafe</html>")], "deklaracija.pdf", {
      type: "application/pdf",
    });
    await expect(validateProductDocument(disguised)).rejects.toThrow(/sadržaj/i);
  });

  it("blokira SVG i izvršne ekstenzije", async () => {
    const svg = new File(["<svg></svg>"], "slika.svg", { type: "image/svg+xml" });
    await expect(validateProductDocument(svg)).rejects.toThrow(/dozvoljeni formati/i);
    const executable = new File([Buffer.from([0x4d, 0x5a])], "alat.exe", {
      type: "application/octet-stream",
    });
    await expect(validateProductDocument(executable)).rejects.toThrow(/dozvoljeni formati/i);
  });

  it("konvertuje DOCX tekst i formatiranje u sanitizovan preview HTML", async () => {
    const buffer = await minimalDocx().generateAsync({ type: "nodebuffer" });
    const file = new File([buffer], "opis.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await expect(validateProductDocument(file, { docxOnly: true })).resolves.toMatchObject({
      extension: "docx",
    });
    const converted = await convertDocxDescription(buffer);
    expect(converted.html).toContain("<h2>Naslov</h2>");
    expect(converted.html).toContain("<strong>Važno</strong>");
    expect(converted.html).not.toMatch(/script|onclick|style=/i);

    const fakeZip = new File(
      [Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
      "lazni.docx",
      {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    );
    await expect(validateProductDocument(fakeZip)).rejects.toThrow(/DOCX paket/i);
  });
});

function minimalDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
      </Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`,
  );
  zip.folder("word")?.file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
      </w:styles>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Naslov</w:t></w:r></w:p>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Važno</w:t></w:r></w:p>
          <w:sectPr/>
        </w:body>
      </w:document>`,
  );
  return zip;
}
