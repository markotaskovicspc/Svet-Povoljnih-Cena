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
      { label: "CRNA", hex: "#181716" },
      { label: "NATUR", hex: "#c7a36f" },
    ]);
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

  it("porodicu prikazuje kao pristupačne foto-linkove ka konkretnom SKU-u", () => {
    const familyProduct = {
      ...product,
      sku: "SOFA-BLACK",
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
            media: { images: [] },
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
            media: { images: [] },
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
});
