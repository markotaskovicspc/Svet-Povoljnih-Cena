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
  it("prikazuje oznaku Heroj meseca zajedno sa oznakom Novo", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          isHero: true,
          isNew: true,
          newUntil: "2100-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(html).toContain('aria-label="Heroj meseca"');
    expect(html).toContain('aria-label="Novo"');
  });

  it("ne prikazuje šifru artikla na kartici", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, { product: readyProduct }),
    );

    expect(html).not.toContain("Šifra artikla");
    expect(html).not.toContain("data-copy-product-sku");
  });

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

    expect(html).toContain("54,5 × 61 × 88 cm");
    expect(html).not.toContain("Dimenzije:");
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
            colorHex: "#8a8a8a",
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
            colorHex: "#72513d",
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

    const productOptions = html.indexOf('aria-label="Opcije proizvoda"');
    const fullPrice = html.indexOf("2.427 RSD");
    const loyaltyPrice = html.indexOf("1.699 RSD");
    expect(html).toContain("min-h-10");
    expect(html).not.toContain("min-h-4");
    expect(productOptions).toBeGreaterThanOrEqual(0);
    expect(fullPrice).toBeGreaterThan(productOptions);
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
      'sizes="(min-width: 1280px) 220px, (min-width: 768px) 210px, (min-width: 640px) 38vw, (min-width: 394px) 46vw, 164px"',
    );
    expect(html).toMatch(/object-contain p-3 transition/);
    expect(html).not.toMatch(/object-contain p-2\.5 transition/);
    expect(html).toContain("gap-1.5 sm:gap-2");
    expect(html).toContain("min-h-6 break-words");
    expect(html).not.toContain("min-h-3.5 truncate");
  });

  it("period akcije ostavlja zaglavlju, a na kartici prikazuje rok isporuke", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          salePrice: 800,
          action: {
            id: "action-august",
            name: "Avgustovska akcija",
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-31T23:59:59.999Z",
          },
        },
      }),
    );

    expect(html).toContain("Isporuka 3–5 radnih dana");
    expect(html).not.toContain("Akcija do");
    expect(html).not.toContain("31.08.2026.");
  });

  it("na aktivnoj akciji ne prikazuje niti koristi loyalty cenu", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          fullPrice: 1_000,
          referencePrice: 900,
          salePrice: 800,
          loyaltyPrice: 700,
          loyaltyDiscountPct: 30,
          loyaltyEligible: true,
          action: {
            id: "active-action",
            name: "Aktivna akcija",
            startsAt: "2026-01-01T00:00:00.000Z",
            endsAt: "2100-12-31T23:59:59.999Z",
          },
        },
      }),
    );

    expect(html).toContain("900 RSD");
    expect(html).toContain("Akcija");
    expect(html).toContain("800 RSD");
    expect(html).not.toContain("Loyalty");
    expect(html).not.toContain("700 RSD");
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

  it("prikazuje piktograme veličine oznake popusta direktno ispod nje", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          supplierIntegrationKey: "RABALUX",
          loyaltyPrice: 700,
          loyaltyDiscountPct: 30,
          pictograms: [
            {
              id: "pictogram-warranty",
              code: "rabalux-warranty-3",
              label: "3 godine garancije",
              iconUrl: "/brand/pictograms/rabalux/warranty-3.png",
            },
            {
              id: "pictogram-led",
              code: "rabalux-led",
              label: "LED tehnologija",
              iconUrl: "/brand/pictograms/rabalux/led.png",
            },
          ],
        },
      }),
    );

    const discountBadge = html.indexOf("-30%");
    const pictograms = html.indexOf("data-product-card-pictograms");

    expect(discountBadge).toBeGreaterThanOrEqual(0);
    expect(pictograms).toBeGreaterThan(discountBadge);
    expect(html).toContain("size-[25px]");
    expect(html).toContain('sizes="(min-width: 768px) 28px, 25px"');
    expect(html).toContain("scale-[1.18]");
  });

  it("prikazuje najviše šest adminskih piktograma preko fotografije", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          supplierIntegrationKey: "RABALUX",
          pictograms: Array.from({ length: 7 }, (_, index) => ({
            id: `pictogram-${index}`,
            code: `card-icon-${index}`,
            label: `Kartica oznaka ${index}`,
            iconUrl: "/brand/pictograms/rabalux/led.png",
          })),
        },
      }),
    );

    expect(html).toContain("data-product-card-pictograms");
    expect(html.match(/title="Kartica oznaka/g)).toHaveLength(6);
    expect(html).not.toContain("Kartica oznaka 6");
  });

  it("prikazuje 2+1 poslednji gore levo, a samo 48h dole desno", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          pictograms: [
            {
              id: "product-feature",
              code: "feature",
              label: "Posebna karakteristika",
              iconUrl: "https://example.test/feature.png",
            },
          ],
        },
      }),
    );

    const features = html.indexOf("data-product-card-pictograms");
    const corner = html.indexOf("data-product-card-corner-pictograms");
    const productFeature = html.indexOf('title="Posebna karakteristika"');
    const warranty = html.indexOf('title="2+1"');
    const deliveryIcon = html.indexOf('title="48h"');

    expect(features).toBeGreaterThanOrEqual(0);
    expect(productFeature).toBeGreaterThan(features);
    expect(warranty).toBeGreaterThan(productFeature);
    expect(corner).toBeGreaterThanOrEqual(0);
    expect(deliveryIcon).toBeGreaterThan(corner);
    expect(corner).toBeGreaterThan(warranty);
    expect(html).toMatch(
      /data-product-card-corner-pictograms[^>]*class="[^"]*right-1 bottom-1[^"]*flex flex-col/,
    );
  });

  it("ne prikazuje 2+1 na Rabalux artiklu, ali zadržava 48h u uglu", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: {
          ...readyProduct,
          supplierIntegrationKey: "RABALUX",
          pictograms: [
            {
              id: "assigned-warranty",
              code: "3",
              label: "2+1",
              iconUrl: "https://example.test/warranty.png",
            },
          ],
        },
      }),
    );

    expect(html).not.toContain('title="2+1"');
    expect(html).toContain("data-product-card-corner-pictograms");
    expect(html).toContain('title="48h"');
  });
});
