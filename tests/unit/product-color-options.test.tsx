import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getProductColorOptions,
  ProductColorOptions,
} from "@/components/product/color-options";
import type { Product } from "@/types";

describe("PDP boje proizvoda", () => {
  const product = {
    colorPrimary: "Crna",
    colorSecondary: "Natur",
  } as Product;

  it("čuva kompaktan prikaz kružića na karticama", () => {
    const markup = renderToStaticMarkup(
      <ProductColorOptions product={product} />,
    );
    expect(markup).not.toContain("Boja:");
    expect(markup).not.toContain("<button");
    expect(getProductColorOptions(product)).toEqual([
      { label: "CRNA", hex: "#181716" },
      { label: "NATUR", hex: "#c7a36f" },
    ]);
  });

  it("na PDP-u prikazuje i tekstualne nazive boja bez lažnog izbora", () => {
    const markup = renderToStaticMarkup(
      <ProductColorOptions
        product={product}
        label="Boja proizvoda"
        showLabels
      />,
    );
    expect(markup).toContain("Boja:");
    expect(markup).toContain("CRNA");
    expect(markup).toContain("NATUR");
    expect(markup).not.toContain("<button");
  });
});
