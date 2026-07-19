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
