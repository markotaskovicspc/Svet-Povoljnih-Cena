import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductSkuCopy } from "@/components/product/product-sku-copy";

describe("kopiranje šifre artikla na PDP-u", () => {
  it("prikazuje šifru i pristupačno dugme za kopiranje", () => {
    const markup = renderToStaticMarkup(<ProductSkuCopy sku="110182" />);

    expect(markup).toContain("110182");
    expect(markup).toContain('aria-label="Kopiraj šifru artikla 110182"');
    expect(markup).toContain('title="Kopiraj šifru artikla"');
  });
});
