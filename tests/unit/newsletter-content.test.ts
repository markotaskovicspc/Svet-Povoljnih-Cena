import { beforeEach, describe, expect, it, vi } from "vitest";

const productFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { product: { findMany: productFindMany } },
}));
vi.mock("@/lib/pricing/rules", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pricing/rules")>("@/lib/pricing/rules");
  return {
    ...actual,
    getActivePricingRules: vi.fn().mockResolvedValue({
      evaluatedAt: "2026-08-20T12:00:00.000Z",
      loyaltyRules: [],
      linearPromotions: [],
    }),
  };
});

describe("newsletter content renderer", () => {
  beforeEach(() => {
    productFindMany.mockReset();
    productFindMany.mockResolvedValue([{
      sku: "SKU-1",
      slug: "test-lampa",
      name: "Test <lampa>",
      shortName: null,
      sizeLabel: null,
      fullPrice: 1_200,
      salePrice: 999,
      action: null,
      actionPrices: [],
      priceListEntries: [],
      groupId: null,
      categories: [],
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

  it("uses the same blue branded shell and connected logo as transactional emails", async () => {
    const { renderNewsletterCampaign } = await import("@/lib/newsletter/content");
    const result = await renderNewsletterCampaign({
      subject: "Nova ponuda",
      baseUrl: "https://shop.example",
      content: [
        { id: "heading", type: "heading", text: "Izdvajamo za vas" },
        { id: "button", type: "button", label: "Pogledaj", href: "/akcija" },
      ],
    });

    expect(result.html).toContain("background:#F2F6F8");
    expect(result.html).toContain("border-top:5px solid #123F5A");
    expect(result.html).toContain('src="https://shop.example/documents/garantni-list-logo.jpeg"');
    expect(result.html).toContain('href="https://shop.example"');
    expect(result.html.indexOf("garantni-list-logo.jpeg")).toBeLessThan(
      result.html.indexOf("Izdvajamo za vas"),
    );
    expect(result.html).toContain('bgcolor="#123F5A"');
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

  it("renders the same active action price as the public storefront", async () => {
    productFindMany.mockResolvedValueOnce([{
      sku: "110087",
      slug: "nov-2026-00003-720e84",
      name: "URBAN SEAT",
      shortName: null,
      sizeLabel: null,
      fullPrice: 2_856,
      salePrice: null,
      action: null,
      actionPrices: [{
        salePrice: 1_499,
        action: {
          id: "action-1",
          name: "Avgustovska akcija",
          priority: 10,
          startsAt: new Date("2026-08-14T00:00:00.000Z"),
          endsAt: new Date("2026-08-31T23:59:59.999Z"),
          isPermanent: false,
        },
      }],
      priceListEntries: [],
      groupId: null,
      categories: [],
      media: [],
    }]);
    const { renderNewsletterCampaign } = await import("@/lib/newsletter/content");
    const result = await renderNewsletterCampaign({
      subject: "Akcijska cena",
      baseUrl: "https://shop.example",
      content: [{ id: "products", type: "products", skus: ["110087"] }],
    });

    expect(result.html).toContain("1.499 RSD");
    expect(result.html).toContain("2.856 RSD");
    expect(result.text).toContain("1.499 RSD");
    expect(result.html).toContain(">1.499 RSD</span><span style=\"color:#5F6F78;text-decoration:line-through;margin-left:7px;\">2.856 RSD</span>");
  });

  it("does not advertise an expired action price", async () => {
    productFindMany.mockResolvedValueOnce([{
      sku: "110087",
      slug: "nov-2026-00003-720e84",
      name: "URBAN SEAT",
      shortName: null,
      sizeLabel: null,
      fullPrice: 2_856,
      salePrice: null,
      action: null,
      actionPrices: [{
        salePrice: 1_499,
        action: {
          id: "expired-action",
          name: "Završena akcija",
          priority: 10,
          startsAt: new Date("2026-08-01T00:00:00.000Z"),
          endsAt: new Date("2026-08-19T23:59:59.999Z"),
          isPermanent: false,
        },
      }],
      priceListEntries: [],
      groupId: null,
      categories: [],
      media: [],
    }]);
    const { renderNewsletterCampaign } = await import("@/lib/newsletter/content");
    const result = await renderNewsletterCampaign({
      subject: "Istekla akcija",
      baseUrl: "https://shop.example",
      content: [{ id: "products", type: "products", skus: ["110087"] }],
    });

    expect(result.html).toContain(">2.856 RSD</span>");
    expect(result.html).not.toContain("1.499 RSD");
    expect(result.text).toContain("2.856 RSD");
  });
});
