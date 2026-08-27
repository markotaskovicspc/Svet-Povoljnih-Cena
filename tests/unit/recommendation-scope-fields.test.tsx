import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendationScopeFields } from "@/components/admin/recommendation-scope-fields";

const groups = [{ id: "chairs", name: "Stolice" }];

describe("nivo pravila preporuke u adminu", () => {
  it("za grupno pravilo prikazuje obavezan izbor grupe", () => {
    const html = renderToStaticMarkup(
      <RecommendationScopeFields
        groups={groups}
        initialScope="GROUP"
        initialGroupId="chairs"
      />,
    );

    expect(html).toContain('name="groupId"');
    expect(html).toContain('value="chairs" selected=""');
    expect(html).not.toContain('name="sourceProductSku"');
  });

  it("za pravilo artikla prikazuje obavezan izvorni SKU", () => {
    const html = renderToStaticMarkup(
      <RecommendationScopeFields
        groups={groups}
        initialScope="PRODUCT"
        initialSourceProductSku="CHAIR-1"
      />,
    );

    expect(html).toContain('name="sourceProductSku"');
    expect(html).toContain('value="CHAIR-1"');
    expect(html).not.toContain('name="groupId"');
  });
});
