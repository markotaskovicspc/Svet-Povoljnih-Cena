import { describe, expect, it } from "vitest";
import {
  normalizeRabaluxMediaUrl,
  parseRabaluxCatalogCsv,
  parseRabaluxCatalogXml,
  parseRabaluxStockCsv,
  rabaluxSku,
  sanitizeRabaluxDescription,
  summarizeRabaluxDryRun,
} from "@/lib/rabalux/parser";

const PRODUCT = `<?xml version="1.0"?><Products><Product>
  <Sku>7996</Sku><Name>Ecuador</Name><Ean11>5998250379968</Ean11>
  <Product_category>Spoljna rasveta</Product_category><Type>Spoljna zidna rasveta</Type>
  <LED_technology>da</LED_technology><Lamp_colour>antracit</Lamp_colour>
  <Material_of_lamp>metal</Material_of_lamp><Material_of_lampshade>plastika</Material_of_lampshade>
  <Horizontal_mm>120</Horizontal_mm><Vertical_mm>220</Vertical_mm><Distance_from_wall>72</Distance_from_wall>
  <Unique_box_size_X_cm>13.5</Unique_box_size_X_cm><Unique_box_size_Y_cm>7.5</Unique_box_size_Y_cm>
  <Unique_box_size_Z_cm>23.5</Unique_box_size_Z_cm><Recommended_price>7390.00</Recommended_price>
  <Recommended_retail_price>0</Recommended_retail_price>
  <Description>&lt;p style="color:red" onclick="bad()"&gt;Bezbedan &lt;strong&gt;opis&lt;/strong&gt;&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;</Description>
  <Product_images><Image>rabaluxkep.plugin.hu/images/7996.jpg</Image></Product_images>
  <Product_fhdimages><Image>rabaluxkep.plugin.hu/images/7996_fhd.jpg</Image></Product_fhdimages>
  <Product_video>rabaluxkep.plugin.hu/images/7996.mp4</Product_video>
  <Manual_pdf>rabaluxkep.plugin.hu/images/7996_manual.pdf</Manual_pdf>
  <Energylabel_pdf>rabaluxkep.plugin.hu/images/7996-energylabel.pdf</Energylabel_pdf>
</Product></Products>`;

describe("Rabalux catalog mapping", () => {
  it("maps identity, pricing, dimensions, media and LED warranty fallback", () => {
    const [item] = parseRabaluxCatalogXml(PRODUCT);
    expect(item.sku).toBe("RAB-7996");
    expect(item.salePrice).toBeNull();
    expect(item.widthCm).toBe(12);
    expect(item.depthCm).toBe(7.2);
    expect(item.heightCm).toBe(22);
    expect(item.warrantyYears).toBe(5);
    expect(item.materials).toEqual(["metal", "plastika"]);
    expect(item.media.filter((asset) => asset.kind === "IMAGE")).toHaveLength(1);
    expect(item.media.find((asset) => asset.kind === "IMAGE")?.sourceUrl).toContain(
      "7996_fhd.jpg",
    );
    expect(item.attachments).toHaveLength(2);
    expect(item.description).toBe("<p>Bezbedan <strong>opis</strong></p>");
  });

  it("keeps invalid full-price products inactive candidates", () => {
    const [item] = parseRabaluxCatalogXml(
      PRODUCT.replace("7390.00", "0").replace("<LED_technology>da", "<LED_technology>ne"),
    );
    expect(item.valid).toBe(false);
    expect(item.validationErrors).toContain("invalid_full_price");
  });

  it("normalizes only the trusted HTTP media host", () => {
    expect(normalizeRabaluxMediaUrl("rabaluxkep.plugin.hu/images/a.jpg")).toBe(
      "https://rabaluxkep.plugin.hu/images/a.jpg",
    );
    expect(
      normalizeRabaluxMediaUrl("http://rabaluxkep.plugin.hu/images/a.jpg"),
    ).toBe("https://rabaluxkep.plugin.hu/images/a.jpg");
    expect(normalizeRabaluxMediaUrl("https://evil.example/images/a.jpg")).toBeNull();
    expect(normalizeRabaluxMediaUrl("http://rabaluxkep.plugin.hu/other/a.jpg")).toBeNull();
  });

  it("uses collision-safe public SKUs", () => {
    expect(rabaluxSku(" 1046 ")).toBe("RAB-1046");
  });

  it("sanitizes active content and attributes", () => {
    expect(
      sanitizeRabaluxDescription(
        '<p onclick="x()">Tekst</p><iframe src="x">bad</iframe>',
      ),
    ).toBe("<p>Tekst</p>");
  });
});

describe("Rabalux stock mapping", () => {
  const header =
    '"Article number";Description;"International Article Number (EAN/UPC)";"Product type";"Product category";Status;"Available quantity";"Unit of Measure";"Next arrival date"';

  it("maps outgoing, restricted, zero stock and next arrival without quantity invention", () => {
    const rows = parseRabaluxStockCsv(
      `${header}\n1053;"Lamp";1;"Ready";"Wall";"outgoing 2026";12;PCS;2026.09.10\n1054;"Lamp";2;"Ready";"Wall";Restricted;0;PCS;`,
    );
    expect(rows[0]).toMatchObject({
      sourceSku: "1053",
      stock: 12,
      outgoing: true,
      restricted: false,
    });
    expect(rows[0].nextArrivalAt?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(rows[1]).toMatchObject({
      stock: 0,
      restricted: true,
      nextArrivalAt: null,
    });
  });

  it("reports catalog-only and stock-only rows without creating stock-only products", () => {
    const catalog = parseRabaluxCatalogXml(PRODUCT);
    const stock = parseRabaluxStockCsv(
      `${header}\n9999;"Other";1;"Ready";"Wall";"";1;PCS;`,
    );
    const summary = summarizeRabaluxDryRun(catalog, stock);
    expect(summary.catalogOnly).toEqual(["7996"]);
    expect(summary.stockOnly).toEqual(["9999"]);
  });
});

describe("Rabalux CSV fallback", () => {
  it("maps the minimum Serbian CSV fields", () => {
    const raw =
      '"Br.stavke";"Prezime";"EAN kod";"Kategorija";"Tip";"LED tehnologija";"Preporučena maloprodajna cena";"Snižena preporučena maloprodajna cena";"FHDPhotos1"\n"42";"Lampa";"123";"Unutrašnja rasveta";"Plafonjera";"da";"1000";"800";"rabaluxkep.plugin.hu/images/42_fhd.jpg"';
    const [item] = parseRabaluxCatalogCsv(raw);
    expect(item).toMatchObject({
      sourceSku: "42",
      sku: "RAB-42",
      fullPrice: 1000,
      salePrice: 800,
      warrantyYears: 5,
      valid: true,
    });
  });
});
