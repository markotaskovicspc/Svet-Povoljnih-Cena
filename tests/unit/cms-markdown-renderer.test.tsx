import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsMarkdown } from "@/components/content/cms-markdown";

describe("CMS Markdown renderer", () => {
  it("renders supported GFM and stable heading ids", () => {
    const html = renderToStaticMarkup(
      <CmsMarkdown markdown={`## Plaćanje {#kartice}

| Način | Status |
| --- | --- |
| Kartica | Dostupno |

[Pomoć](/pomoc)`} />,
    );

    expect(html).toContain('id="kartice"');
    expect(html).not.toContain("{#kartice}");
    expect(html).toContain("<table>");
    expect(html).toContain('href="/pomoc"');
  });

  it("does not render raw HTML, Markdown images or unsafe link destinations", () => {
    const html = renderToStaticMarkup(
      <CmsMarkdown
        markdown={`<script>alert(1)</script>

![slika](https://example.com/image.jpg)

[napad](javascript:alert(1))`}
      />,
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("napad");
  });
});
