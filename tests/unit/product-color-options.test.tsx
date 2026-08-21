import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getProductColorOptions,
  ProductColorOptions,
} from "@/components/product/color-options";
import type { Product } from "@/types";

describe("PDP boje proizvoda", () => {
  const product = {
    sku: "CHAIR-BLACK",
    colorPrimary: "Crna",
    colorSecondary: "Natur",
    media: { images: [{ url: "/products/chair-black.webp" }] },
  } as Product;

  it("prikazuje boje i naziv na karticama", () => {
    const markup = renderToStaticMarkup(
      <ProductColorOptions product={product} />,
    );
    expect(markup).not.toContain("Boja:");
    expect(markup).not.toContain("<button");
    expect(getProductColorOptions(product)).toEqual([
      {
        label: "CRNA / NATUR",
        colors: ["#181716", "#c7a36f"],
      },
    ]);
    expect(markup).toContain("data-product-colors");
    expect(markup).toContain("CRNA / NATUR");
    expect(markup.match(/rounded-full/g)).toHaveLength(2);
    expect(markup).not.toContain('title="CRNA / NATUR"');
  });

  it("na PDP-u prikazuje samo thumbnail varijante bez vidljivog naziva boje", () => {
    const markup = renderToStaticMarkup(
      <ProductColorOptions
        product={product}
        label="Boja proizvoda"
        showLabels
      />,
    );
    expect(markup).not.toContain("Boja:");
    expect(markup).toContain('aria-label="Boja proizvoda: CRNA / NATUR"');
    expect(markup).not.toContain(">CRNA / NATUR<");
    expect(markup).not.toContain("<button");
    expect(markup).toContain("Varijanta:");
    expect(markup.match(/data-variant-thumbnail/g)).toHaveLength(1);
    expect(markup.match(/<img/g)).toHaveLength(1);
    expect(markup).toContain("bg-white");
    expect(markup).not.toContain("data-color-count=");
    expect(markup).not.toContain("linear-gradient(135deg");
    expect(markup).not.toContain("linear-gradient(90deg");
  });

  it("porodicu prikazuje kao pristupačne linkove ka konkretnom SKU-u", () => {
    const familyProduct = {
      ...product,
      sku: "SOFA-BLACK",
      colorSecondary: undefined,
      variantFamily: {
        id: "family-1",
        code: "SOFA",
        primarySku: "SOFA-BLACK",
        selectedSku: "SOFA-BLACK",
        options: [
          {
            sku: "SOFA-BLACK",
            slug: "sofa-black",
            name: "Sofa",
            label: "Crna",
            colorHex: "#111111",
            position: 0,
            isPrimary: true,
            thumbnail: { url: "/products/sofa-black.webp" },
            media: { images: [{ url: "/products/sofa-black.webp" }] },
            fullPrice: 100,
            stock: 1,
            incomingStock: 0,
            deliveryDays: { min: 3, max: 5 },
          },
          {
            sku: "SOFA-GREEN",
            slug: "sofa-green",
            name: "Sofa",
            label: "Zelena",
            colorHex: "#228833",
            position: 1,
            isPrimary: false,
            thumbnail: { url: "/products/sofa-green.webp" },
            media: { images: [{ url: "/products/sofa-green.webp" }] },
            fullPrice: 100,
            stock: 2,
            incomingStock: 0,
            deliveryDays: { min: 3, max: 5 },
          },
        ],
      },
    } as Product;
    const markup = renderToStaticMarkup(
      <ProductColorOptions
        product={familyProduct}
        label="Boja proizvoda"
        showLabels
      />,
    );
    expect(markup).toContain('aria-label="Boja proizvoda"');
    expect(markup).toContain('href="/p/sofa-black"');
    expect(markup).toContain('href="/p/sofa-green"');
    expect(markup).toContain("Crna");
    expect(markup).not.toContain(">Crna</span>");
    expect(markup).not.toContain(">Zelena</span>");
    expect(markup).toContain("SKU SOFA-GREEN");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Varijanta:");
    expect(markup).not.toContain("Boja:");
    expect(markup.match(/data-variant-thumbnail/g)).toHaveLength(2);
    expect(markup.match(/<img/g)).toHaveLength(2);
    expect(markup).not.toContain("data-color-count=");
    expect(markup).not.toContain("linear-gradient(135deg");
  });

  it("na kartici prikazuje sve boje u jednom pristupačnom karuselu", () => {
    const options = Array.from({ length: 6 }, (_, index) => ({
      sku: `SKU-${index + 1}`,
      slug: `sku-${index + 1}`,
      name: "Artikal",
      label: `Boja ${index + 1}`,
      position: index,
      isPrimary: index === 0,
      thumbnail: { url: `/products/sku-${index + 1}.webp` },
      media: { images: [{ url: `/products/sku-${index + 1}.webp` }] },
      fullPrice: 100,
      stock: 1,
      incomingStock: 0,
      deliveryDays: { min: 3, max: 5 },
    }));
    const markup = renderToStaticMarkup(
      <ProductColorOptions
        product={{
          ...product,
          sku: "SKU-1",
          variantFamily: {
            id: "six-colors",
            code: "SIX",
            selectedSku: "SKU-1",
            options,
          },
        } as Product}
        selectedSku="SKU-1"
        onSelectSku={() => undefined}
      />,
    );

    expect(markup.match(/data-variant-thumbnail/g)).toHaveLength(6);
    expect(markup.match(/data-variant-option/g)).toHaveLength(6);
    expect(markup.match(/<button/g)).toHaveLength(8);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-roledescription="carousel"');
    expect(markup).toContain("flex-nowrap");
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("Prethodna varijanta");
    expect(markup).toContain("Sledeća varijanta");
    expect(markup).not.toContain("+2");
    expect(markup).not.toContain('href="/p/sku-6"');
  });

  it("porodičnu varijantu prikazuje thumbnailom bez dodatnog kružića ispod", () => {
    const familyProduct = {
      ...product,
      sku: "MOP-RED-WHITE",
      colorPrimary: "crvena",
      colorSecondary: "bela",
      variantFamily: {
        id: "mops",
        code: "MOP",
        selectedSku: "MOP-RED-WHITE",
        options: [
          {
            sku: "MOP-RED-WHITE",
            slug: "mop-red-white",
            name: "Mop",
            label: "Crvena / bela",
            colorPrimary: "crvena",
            colorSecondary: "bela",
            position: 0,
            isPrimary: true,
            thumbnail: { url: "/products/mop-red-white.webp" },
            media: { images: [{ url: "/products/mop-red-white.webp" }] },
            fullPrice: 100,
            stock: 1,
            incomingStock: 0,
            deliveryDays: { min: 3, max: 5 },
          },
        ],
      },
    } as Product;

    const markup = renderToStaticMarkup(
      <ProductColorOptions product={familyProduct} />,
    );

    expect(markup.match(/data-variant-thumbnail/g)).toHaveLength(1);
    expect(markup).not.toContain("data-color-count=");
    expect(markup).not.toContain("linear-gradient(90deg");
  });

  it("dimenzijsku porodicu naziva varijantom, a ne bojom", () => {
    const familyProduct = {
      ...product,
      sku: "BED-190X80",
      colorPrimary: undefined,
      colorSecondary: undefined,
      variantFamily: {
        id: "bed-sizes",
        code: "BED",
        selectedSku: "BED-190X80",
        options: [
          {
            sku: "BED-190X80",
            slug: "bed-190x80",
            name: "Krevet",
            label: "190x80",
            position: 0,
            isPrimary: true,
            media: { images: [] },
            fullPrice: 100,
            stock: 1,
            incomingStock: 0,
            deliveryDays: { min: 3, max: 5 },
          },
        ],
      },
    } as Product;

    const markup = renderToStaticMarkup(
      <ProductColorOptions product={familyProduct} showLabels />,
    );
    expect(markup).toContain('aria-label="Opcije proizvoda"');
    expect(markup).toContain("Varijanta:");
    expect(markup).not.toContain("Boja:");
  });

  it("ne prikazuje dimenziju koju je import pogrešno upisao kao boju", () => {
    expect(
      getProductColorOptions({
        ...product,
        colorPrimary: "190x80",
        colorSecondary: undefined,
      }),
    ).toEqual([]);
  });
});
