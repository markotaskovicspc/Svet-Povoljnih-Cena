import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductCard } from "@/components/product/product-card";
import type { Product } from "@/types";

const readyProduct: Product = {
  sku: "QA-IMAGE-001",
  slug: "qa-image-001",
  name: "QA proizvod",
  group: "QA",
  categoryPath: ["QA"],
  description: "Proizvod za proveru kartice.",
  dimensionsCm: { w: 10, d: 10, h: 10 },
  materials: [],
  pictograms: [],
  stock: 1,
  incomingStock: 0,
  fullPrice: 1_000,
  deliveryDays: { min: 3, max: 5 },
  allowsAssembly: false,
  assemblyCities: [],
  media: {
    images: [
      {
        url: "https://example.test/original-first.jpg",
        cardUrl: "https://example.test/card-first.jpg",
        alt: "Prva fotografija",
      },
      {
        url: "https://example.test/original-second.jpg",
        cardUrl: "https://example.test/card-second.jpg",
        alt: "Druga fotografija",
      },
    ],
  },
  recommendedSkus: [],
  frequentlyBoughtSkus: [],
};

describe("ProductCard image regression", () => {
  it("prikazuje dimenzije umesto kratkog opisa", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          shortDescription: "Ovaj tekst ne pripada kartici",
          dimensionsCm: { w: 54.5, d: 61, h: 88 },
        },
      }),
    );

    expect(html).toContain("Dimenzije: 54,5 × 61 × 88 cm");
    expect(html).not.toContain("Ovaj tekst ne pripada kartici");
  });

  it("ne precrtava redovnu cenu i prikazuje loyalty cenu crveno", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          fullPrice: 2_427,
          loyaltyPrice: 1_699,
          loyaltyDiscountPct: 30,
        },
      }),
    );

    expect(html).toContain("2.427 RSD");
    expect(html).toContain("1.699 RSD");
    expect(html).not.toContain("line-through");
    expect(html).toMatch(/text-action[^>]*>1\.699 RSD/);
  });

  it("ostavlja foto-opcije u toku kartice iznad obe cene", () => {
    const familyProduct: Product = {
      ...readyProduct,
      fullPrice: 2_427,
      loyaltyPrice: 1_699,
      loyaltyDiscountPct: 30,
      variantFamily: {
        id: "family-card-1",
        code: "QA-CARD",
        primarySku: "QA-IMAGE-001",
        selectedSku: "QA-IMAGE-001",
        options: [
          {
            sku: "QA-IMAGE-001",
            slug: "qa-image-001",
            name: "QA proizvod",
            label: "Siva",
            position: 0,
            isPrimary: true,
            thumbnail: { url: "https://example.test/thumb-grey.jpg" },
            media: readyProduct.media,
            fullPrice: 2_427,
            loyaltyPrice: 1_699,
            loyaltyDiscountPct: 30,
            stock: 1,
            incomingStock: 0,
            deliveryDays: { min: 3, max: 5 },
          },
          {
            sku: "QA-IMAGE-002",
            slug: "qa-image-002",
            name: "QA proizvod",
            label: "Braon",
            position: 1,
            isPrimary: false,
            thumbnail: { url: "https://example.test/thumb-brown.jpg" },
            media: readyProduct.media,
            fullPrice: 2_427,
            loyaltyPrice: 1_699,
            loyaltyDiscountPct: 30,
            stock: 1,
            incomingStock: 0,
            deliveryDays: { min: 3, max: 5 },
          },
        ],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ProductCard, { product: familyProduct }),
    );

    const colorOptions = html.indexOf('aria-label="Opcije boja"');
    const fullPrice = html.indexOf("2.427 RSD");
    const loyaltyPrice = html.indexOf("1.699 RSD");
    const colorOptionsClass = html.match(
      /<div class="([^"]+)" aria-label="Opcije boja">/,
    )?.[1].split(" ");

    expect(colorOptionsClass).toContain("min-h-4");
    expect(colorOptionsClass).not.toContain("h-4");
    expect(colorOptions).toBeGreaterThanOrEqual(0);
    expect(fullPrice).toBeGreaterThan(colorOptions);
    expect(loyaltyPrice).toBeGreaterThan(fullPrice);
  });

  it("renders the ordered first card image in the initial HTML", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, { product: readyProduct }),
    );

    const firstSlide = html.indexOf('data-card-image="0"');
    const firstImage = html.indexOf("card-first.jpg");
    const secondSlide = html.indexOf('data-card-image="1"');
    const secondImage = html.indexOf("card-second.jpg");

    expect(firstSlide).toBeGreaterThanOrEqual(0);
    expect(firstImage).toBeGreaterThan(firstSlide);
    expect(secondSlide).toBeGreaterThan(firstImage);
    expect(secondImage).toBeGreaterThan(secondSlide);
    expect(html).toContain('alt="Prva fotografija"');
  });

  it("keeps compact responsive image sizing and the restored white space", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          loyaltyPrice: 700,
          loyaltyDiscountPct: 30,
        },
      }),
    );

    expect(html).toContain(
      'sizes="(min-width: 1280px) 220px, (min-width: 768px) 210px, (min-width: 640px) 25vw, (min-width: 394px) 32vw, 126px"',
    );
    expect(html).toMatch(/object-contain p-3 transition/);
    expect(html).not.toMatch(/object-contain p-2\.5 transition/);
    expect(html).toContain("gap-1.5 sm:gap-2");
    expect(html).toContain("min-h-6 break-words");
    expect(html).not.toContain("min-h-3.5 truncate");
  });

  it("keeps duplicate product cards independent on the same page", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(ProductCard, { product: readyProduct }),
        createElement(ProductCard, { product: readyProduct }),
      ),
    );

    expect(html.match(/alt="Prva fotografija"/g)).toHaveLength(2);
    expect(html.match(/data-card-image="0"/g)).toHaveLength(2);
  });

  it("does not render gallery controls for a one-image card", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          media: { images: readyProduct.media.images.slice(0, 1) },
        },
      }),
    );

    expect(html).not.toContain("Prethodna fotografija");
    expect(html).not.toContain("Sledeća fotografija");
    expect(html).not.toContain("data-card-image-dot");
  });

  it("renders the explicit fallback when media is missing", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: { ...readyProduct, media: { images: [] } },
      }),
    );

    expect(html).toContain("Slika proizvoda nije dostupna");
    expect(html).not.toContain("data-card-image=");
  });
});
