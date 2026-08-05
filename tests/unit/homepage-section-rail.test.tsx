import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionRail } from "@/components/home/section-rail";
import type { Product } from "@/types";

const product: Product = {
  sku: "QA-COMPACT-001",
  slug: "qa-compact-001",
  name: "Kompaktna kartica",
  group: "QA",
  categoryPath: ["QA"],
  description: "Proizvod za proveru širine kartice.",
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
        url: "https://example.test/original.jpg",
        cardUrl: "https://example.test/card.jpg",
        alt: "Kompaktna kartica",
      },
    ],
  },
  recommendedSkus: [],
  frequentlyBoughtSkus: [],
};

describe("homepage section rail", () => {
  it("keeps an opted-in empty CMS section visible in its configured slot", () => {
    const html = renderToStaticMarkup(
      <SectionRail
        title="Heroji meseca"
        href="/heroji-meseca"
        products={[]}
        emptyMessage="Trenutno nema dostupnih proizvoda u ovoj sekciji."
      />,
    );

    expect(html).toContain("Heroji meseca");
    expect(html).toContain(
      "Trenutno nema dostupnih proizvoda u ovoj sekciji.",
    );
    expect(html).toContain('href="/heroji-meseca"');
  });

  it("preserves the existing collapsed behavior for other empty rails", () => {
    const html = renderToStaticMarkup(
      <SectionRail title="Povezani proizvodi" href="/akcija" products={[]} />,
    );

    expect(html).toBe("");
  });

  it("uses compact card widths without removing product content", () => {
    const html = renderToStaticMarkup(
      <SectionRail
        title="Kompaktna ponuda"
        href="/akcija"
        products={[product]}
        compactCardsOnDesktop
      />,
    );

    expect(html).toContain("w-[32vw]");
    expect(html).toContain("min-w-[126px]");
    expect(html).toContain("sm:w-[25vw]");
    expect(html).toContain("md:w-[clamp(180px,calc(16.5%_-_14px),200px)]");
    expect(html).toContain("md:h-20");
    expect(html).toContain("Kompaktna kartica");
    expect(html).toContain("Dimenzije: 10 × 10 × 10 cm");
    expect(html).toContain("1.000 RSD");
  });

  it("keeps the regular card treatment outside opted-in homepage rails", () => {
    const html = renderToStaticMarkup(
      <SectionRail title="Povezani proizvodi" href="/akcija" products={[product]} />,
    );

    expect(html).toContain("md:w-[clamp(162px,calc(18%_-_14px),220px)]");
    expect(html).not.toContain("md:h-20");
  });
});
