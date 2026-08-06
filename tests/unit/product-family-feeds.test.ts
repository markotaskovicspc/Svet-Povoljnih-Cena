import { describe, expect, it } from "vitest";
import { buildGoogleMerchantXml } from "@/lib/feeds/google";
import { buildMetaCsv } from "@/lib/feeds/meta";
import { buildTiktokCsv } from "@/lib/feeds/tiktok";
import type { FeedProduct } from "@/lib/feeds/types";

const product: FeedProduct = {
  id: "SOFA-GREEN",
  sku: "SOFA-GREEN",
  title: "Sofa",
  description: "Opis",
  link: "https://example.com/p/sofa-green",
  imageLink: "https://example.com/sofa-green.jpg",
  additionalImageLinks: [],
  price: 10_000,
  salePrice: null,
  currency: "RSD",
  availability: "in stock",
  brand: "SPC",
  condition: "new",
  googleProductCategory: "Furniture",
  productType: "Nameštaj > Sofe",
  gtin: null,
  mpn: "SOFA-GREEN",
  itemGroupId: "SOFA",
  color: "Maslinasto zelena",
};

describe("family metadata u oglasnim feedovima", () => {
  it("emituje grupu i boju za Google", () => {
    const xml = buildGoogleMerchantXml([product]);
    expect(xml).toContain("<g:item_group_id>SOFA</g:item_group_id>");
    expect(xml).toContain("<g:color>Maslinasto zelena</g:color>");
  });

  it("emituje grupu i boju za Meta i TikTok", () => {
    expect(buildMetaCsv([product])).toContain("SOFA,Maslinasto zelena");
    expect(buildTiktokCsv([product])).toContain("SOFA,Maslinasto zelena");
  });
});
