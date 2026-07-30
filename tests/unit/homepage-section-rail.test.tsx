import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionRail } from "@/components/home/section-rail";

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
});
