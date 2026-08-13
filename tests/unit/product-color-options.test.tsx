import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getProductColorOptions,
  ProductColorOptions,
} from "@/components/product/color-options";
import type { Product } from "@/types";

describe("PDP boje proizvoda", () => {
  const product = {
    colorPrimary: "Crna",
    colorSecondary: "Natur",
  } as Product;

  it("čuva kompaktan prikaz kružića na karticama", () => {
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
    expect(markup).toContain('data-color-count="2"');
    expect(markup).toContain("linear-gradient(90deg");
  });

  it("na PDP-u prikazuje i tekstualne nazive boja bez lažnog izbora", () => {
    const markup = renderToStaticMarkup(
      <ProductColorOptions
        product={product}
        label="Boja proizvoda"
        showLabels
      />,
    );
    expect(markup).toContain("Boja:");
    expect(markup).toContain("CRNA");
    expect(markup).toContain("NATUR");
    expect(markup).not.toContain("<button");
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
      <ProductColorOptions product={familyProduct} showLabels max={12} />,
    );
    expect(markup).toContain('href="/p/sofa-black"');
    expect(markup).toContain('href="/p/sofa-green"');
    expect(markup).toContain("Crna");
    expect(markup).toContain("SKU SOFA-GREEN");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Varijanta:");
    expect(markup).toContain("Boja:");
    expect(markup.match(/data-variant-thumbnail/g)).toHaveLength(2);
    expect(markup.match(/<img/g)).toHaveLength(2);
    expect(markup.match(/data-color-count=/g)).toHaveLength(1);
  });

  it("porodičnu varijantu prikazuje thumbnailom, a njene dve boje jednim podeljenim kružićem", () => {
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
    expect(markup.match(/data-color-count=/g)).toHaveLength(1);
    expect(markup).toContain('data-color-count="2"');
    expect(markup).toContain("#c83a31 0 50%");
    expect(markup).toContain("#f8f7f2 50% 100%");
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
