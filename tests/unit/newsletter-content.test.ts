import { beforeEach, describe, expect, it, vi } from "vitest";

const productFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { product: { findMany: productFindMany } },
}));

describe("newsletter content renderer", () => {
  beforeEach(() => {
    productFindMany.mockReset();
    productFindMany.mockResolvedValue([{
      sku: "SKU-1",
      slug: "test-lampa",
      name: "Test <lampa>",
      shortName: null,
      fullPrice: 1_200,
      salePrice: 999,
      media: [],
    }]);
  });

  it("escapes authored HTML and keeps mandatory unsubscribe content", async () => {
    const { renderNewsletterCampaign } = await import("@/lib/newsletter/content");
    const result = await renderNewsletterCampaign({
      subject: "Akcija <script>",
      previewText: "Pregled <b>",
      baseUrl: "https://shop.example",
      content: [
        { id: "heading", type: "heading", text: "<script>alert(1)</script>" },
        { id: "button", type: "button", label: "Kupi", href: "/ponuda" },
      ],
    });
    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.html).toContain("https://shop.example/ponuda");
    expect(result.html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(result.text).toContain("Odjava:");
  });

  it("uses real product routes and warns when a requested SKU is unavailable", async () => {
    const { renderNewsletterCampaign } = await import("@/lib/newsletter/content");
    const result = await renderNewsletterCampaign({
      subject: "Proizvodi",
      baseUrl: "https://shop.example",
      content: [{ id: "products", type: "products", title: "Izdvajamo", skus: ["SKU-1", "MISSING"] }],
    });
    expect(result.html).toContain("https://shop.example/p/test-lampa");
    expect(result.text).toContain("https://shop.example/p/test-lampa");
    expect(result.warnings).toContain("Artikal MISSING nije aktivan ili nije dostupan za web i izostavljen je.");
  });
});
